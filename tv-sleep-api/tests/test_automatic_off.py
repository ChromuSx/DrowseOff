import http.client
import importlib.util
import json
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch

from tv_sleep import broadlink_remote, db, server


class SilentHandler(server.Handler):
    def log_message(self, fmt, *args):
        pass


class AutomaticOffTests(unittest.TestCase):
    def setUp(self):
        temp = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.object(db, "DB_PATH", str(Path(temp) / "test.db")))
        db.ensure_db()
        self.enterContext(patch.object(server, "API_TOKEN", "test"))
        self.enterContext(patch.object(server, "REMOTE_AUTO_ENABLED", True))
        self.power = self.enterContext(patch.object(server, "record_power_status", return_value={"ready": False}))
        self.confirm = self.enterContext(patch.object(server, "schedule_tv_off_confirmation", return_value=False))
        self.transmit = Mock(return_value={"provider": "broadlink", "repeat_count": 1, "sent": True})
        self.prepare = self.enterContext(patch.object(server, "prepare_remote_tv_off", return_value=self.transmit))
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), SilentHandler)
        thread = threading.Thread(target=self.http.serve_forever, kwargs={"poll_interval": 0.01})
        thread.start()
        self.addCleanup(self.http.server_close)
        self.addCleanup(thread.join)
        self.addCleanup(self.http.shutdown)

    def post(self, path, payload):
        conn = http.client.HTTPConnection("127.0.0.1", self.http.server_port, timeout=10)
        try:
            conn.request("POST", path, json.dumps(payload), {"Authorization": "Bearer test"})
            response = conn.getresponse()
            return response.status, json.load(response)
        finally:
            conn.close()

    def threshold(self, trigger_id="one", **fields):
        payload = dict(device_id="sensor", event_type="tv_off_threshold_reached", sleep_score=600)
        if trigger_id is not None:
            payload["trigger_id"] = trigger_id
        return self.post("/api/events", {**payload, **fields})

    def test_monitor_blocks_stale_firmware_and_manual_off_still_works(self):
        self.post("/api/settings", {"auto_power_enabled": 0})
        status, response = self.threshold(attempt=1)
        self.assertEqual((status, response["remote"]["status"]), (409, "disabled"))
        self.prepare.assert_not_called()
        with patch.object(server, "remote_send_tv_off", self.transmit):
            self.assertEqual(self.post("/api/remote/send-off", {"repeat_count": 1})[0], 200)
        self.transmit.assert_called_once_with(1)
        self.post("/api/settings", {"auto_power_enabled": 1})
        self.assertEqual(self.threshold(attempt=2), (status, response))

    def test_monitor_enabled_during_preparation_prevents_transmission(self):
        started, resume = threading.Event(), threading.Event()

        def slow_connection(**kwargs):
            started.set()
            self.assertTrue(resume.wait(5))
            return self.transmit

        self.prepare.side_effect = slow_connection
        with ThreadPoolExecutor(1) as pool:
            request = pool.submit(self.threshold)
            try:
                self.assertTrue(started.wait(5))
                self.assertEqual(self.post("/api/settings", {"auto_power_enabled": 0})[0], 200)
            finally:
                resume.set()
            self.assertEqual(request.result()[0], 409)
        self.transmit.assert_not_called()

    def test_concurrent_retries_return_original_response_after_database_reopen(self):
        with ThreadPoolExecutor(4) as pool:
            replies = list(pool.map(lambda n: self.threshold(attempt=n), range(1, 5)))
        self.assertEqual(replies, [replies[0]] * 4)
        self.assertEqual(replies[0][0], 201)
        db.ensure_db()
        self.assertEqual(self.threshold(attempt=5), replies[0])
        self.transmit.assert_called_once_with(1)
        self.confirm.assert_called_once()
        self.assertCountEqual([r["event_type"] for r in db.get_events(10)], [
            "tv_off_threshold_reached", "tv_off_remote_auto",
        ])

    def test_distinct_episodes_and_devices(self):
        self.threshold()
        self.threshold("two")
        self.threshold(device_id="other")
        self.assertEqual(self.transmit.call_count, 3)

    def test_safe_connection_failure_can_retry(self):
        self.prepare.side_effect = [TimeoutError("offline before IR"), self.transmit]
        status, failed = self.threshold(attempt=1)
        self.assertEqual((status, failed["remote"]["status"]), (503, "failed"))
        status, sent = self.threshold(attempt=2)
        self.assertEqual((status, sent["id"]), (201, failed["id"]))
        self.transmit.assert_called_once_with(1)

    def test_lost_ack_is_terminal(self):
        self.transmit.side_effect = TimeoutError("IR acknowledgement lost")
        first = self.threshold()
        self.assertEqual((first[0], first[1]["remote"]["status"]), (409, "uncertain"))
        self.assertEqual(self.threshold(attempt=2), first)
        self.transmit.assert_called_once_with(1)

    def test_interrupted_dispatch_is_not_repeated(self):
        event_id, _ = db.get_or_create_threshold_event(dict(
            device_id="sensor", trigger_id="one", event_type="tv_off_threshold_reached",
        ))
        db.store_auto_result(event_id, {"ok": False, "status": "uncertain", "error": "interrupted"})
        db.ensure_db()
        self.assertEqual(self.threshold()[0], 409)
        self.prepare.assert_not_called()

    def test_legacy_retry_and_rearm_without_trigger_id(self):
        first = self.threshold(None)
        self.assertEqual(self.threshold(None, attempt=2), first)
        self.post("/api/readings", dict(device_id="other", threshold=600, sleep_score=0))
        self.post("/api/readings", dict(device_id="sensor", threshold=600, sleep_score=580))
        self.assertEqual(self.threshold(None), first)
        self.post("/api/readings", dict(device_id="sensor", threshold=600, sleep_score=300))
        self.assertNotEqual(self.threshold(None)[1]["id"], first[1]["id"])
        self.assertEqual(self.transmit.call_count, 2)

    def test_legacy_inflight_retry_after_upgrade(self):
        original = db.insert_event(dict(device_id="sensor", event_type="tv_off_threshold_reached"))
        db.insert_event(dict(device_id="sensor", event_type="tv_off_remote_auto"))
        status, result = self.threshold(None, attempt=2)
        self.assertEqual((status, result["id"], result["remote"]["status"]), (201, original, "sent"))
        self.prepare.assert_not_called()

    def test_already_off_and_environment_disable(self):
        self.power.return_value = {"ready": True, "tv_on": False}
        first = self.threshold()
        self.assertEqual(first[1]["remote"]["status"], "skipped_already_off")
        self.assertEqual(self.threshold(), first)
        with patch.object(server, "REMOTE_AUTO_ENABLED", False):
            self.assertEqual(self.threshold("two")[0], 409)
        self.prepare.assert_not_called()

    def test_invalid_key_is_rejected_before_dispatch(self):
        for invalid in ("", [], "x" * 129):
            self.assertEqual(self.threshold(invalid)[0], 400)
        self.prepare.assert_not_called()


@unittest.skipUnless(importlib.util.find_spec("broadlink"), "requires the production BroadLink library")
class BroadlinkTransportTests(unittest.TestCase):
    def test_lost_udp_ack_sends_only_one_datagram(self):
        import broadlink
        from broadlink.exceptions import NetworkTimeoutError

        device = broadlink.gendevice(0x2737, ("127.0.0.1", 80), bytes(6))
        udp = Mock()
        def timeout(_size):
            time.sleep(udp.settimeout.call_args.args[0] + 0.01)
            raise TimeoutError()

        udp.recvfrom.side_effect = timeout
        with patch.object(broadlink_remote, "_device", return_value=device), \
             patch.object(broadlink_remote, "_read_packet", return_value=b"test"), \
             patch("broadlink.device.socket.socket") as sock:
            sock.return_value.__enter__.return_value = udp
            send = broadlink_remote.prepare_tv_off(automatic=True)
            with self.assertRaises(NetworkTimeoutError):
                send()
        self.assertEqual(udp.sendto.call_count, 1)
