"""Static guards for firmware scoring; Arduino builds are performed manually."""
import re
import unittest
from pathlib import Path


SKETCH = (
    Path(__file__).resolve().parents[2]
    / "firmware/esp32_sleep_sensor/esp32_sleep_sensor.ino"
).read_text(encoding="utf-8")


class SleepGuardTests(unittest.TestCase):
    def test_only_stable_stationary_samples_without_movement_earn_points(self):
        self.assertRegex(
            SKETCH,
            r"bool quietForSleep = personInBed && stableDistance && still && !moving;",
        )
        positive_branches = re.findall(
            r"if \(([^\n]+)\) \{\s*sleepScore \+= 1;", SKETCH
        )
        self.assertEqual(positive_branches, ["quietForSleep"])
        self.assertEqual(SKETCH.count("sleepScore += 1;"), 1)

    def test_movement_reduces_score_even_if_distance_is_stable(self):
        self.assertRegex(SKETCH, r"else if \(moving\) \{\s*sleepScore -= 1;")

    def test_shared_auto_off_branch_requires_current_quiet_sample(self):
        self.assertRegex(
            SKETCH,
            r"if \(quietForSleep && sleepScore >= sleepThreshold && !tvAlreadyOff && autoPowerEnabled\) \{"
            r"\s*Serial\.print\(\" \| TV OFF\"\);\s*if \(esp32IrAutoEnabled\)",
        )
