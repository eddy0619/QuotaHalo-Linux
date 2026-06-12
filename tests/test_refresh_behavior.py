import json
import os
import re
import tempfile
import time
import unittest
from pathlib import Path

import quota_halo_status as qhs


class RefreshBehaviorTests(unittest.TestCase):
    def test_claude_force_refresh_bypasses_fresh_usage_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            status_dir = Path(tmp) / "quotahalo"
            status_dir.mkdir()
            cache_path = status_dir / "claude-usage-cache.json"
            cache_path.write_text(
                json.dumps(
                    {
                        "provider": "Claude",
                        "plan": "Pro",
                        "updated": "Updated 00:00:00",
                        "updated_epoch": int(time.time()),
                        "session_used_pct": 11,
                        "session_reset": "1h",
                        "weekly_used_pct": 22,
                        "weekly_reset": "1d",
                        "source": "oauth",
                        "_cached_at": time.time(),
                    }
                ),
                encoding="utf-8",
            )

            original_status_dir = qhs.STATUS_DIR
            original_cache_file = qhs.CLAUDE_USAGE_CACHE_FILE
            qhs.STATUS_DIR = status_dir
            qhs.CLAUDE_USAGE_CACHE_FILE = cache_path
            try:
                class Fetcher(qhs.ClaudeDataFetcher):
                    def __init__(self):
                        super().__init__()
                        self.oauth_calls = 0

                    def _fetch_oauth_api(self, force=False):
                        self.oauth_calls += 1
                        data = self._empty()
                        data.update(
                            {
                                "plan": "Pro",
                                "source": "oauth",
                                "session_used_pct": 44,
                                "weekly_used_pct": 55,
                            }
                        )
                        return data

                    def _fetch_jsonl(self):
                        return None

                    def _is_claude_installed(self):
                        return True

                fetcher = Fetcher()
                data = fetcher.fetch_all(force=True)
            finally:
                qhs.STATUS_DIR = original_status_dir
                qhs.CLAUDE_USAGE_CACHE_FILE = original_cache_file

            self.assertEqual(fetcher.oauth_calls, 1)
            self.assertEqual(data["session_used_pct"], 44)
            self.assertEqual(data["weekly_used_pct"], 55)

    def test_codex_uses_latest_rate_limit_event(self):
        with tempfile.TemporaryDirectory() as tmp:
            codex_dir = Path(tmp) / ".codex"
            sessions_dir = codex_dir / "sessions"
            sessions_dir.mkdir(parents=True)

            old_file = sessions_dir / "old.jsonl"
            new_file = sessions_dir / "new.jsonl"
            now_epoch = int(time.time())
            old_file.write_text(
                json.dumps(
                    {
                        "timestamp": "2026-06-10T08:00:00Z",
                        "payload": {
                            "type": "token_count",
                            "rate_limits": {
                                "primary": {
                                    "used_percent": 90,
                                    "resets_at": now_epoch + 7200,
                                }
                            },
                        },
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            new_file.write_text(
                json.dumps(
                    {
                        "timestamp": "2026-06-10T09:00:00Z",
                        "payload": {
                            "type": "token_count",
                            "rate_limits": {
                                "primary": {
                                    "used_percent": 12,
                                    "resets_at": now_epoch + 3600,
                                }
                            },
                        },
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            os.utime(old_file, (time.time() - 200, time.time() - 200))
            os.utime(new_file, (time.time(), time.time()))

            original_codex_dir = qhs.CodexDataFetcher.CODEX_DIR
            qhs.CodexDataFetcher.CODEX_DIR = codex_dir
            try:
                data = qhs.CodexDataFetcher().fetch()
            finally:
                qhs.CodexDataFetcher.CODEX_DIR = original_codex_dir

            self.assertEqual(data["source"], "sessions")
            self.assertEqual(data["session_used_pct"], 12)

    def test_copilot_refresh_updates_ui_after_subprocess_finishes(self):
        extension_path = (
            Path(__file__).resolve().parents[1]
            / "gnome-extension"
            / "quotahalo@local"
            / "extension.js"
        )
        text = extension_path.read_text(encoding="utf-8")
        match = re.search(
            r"_requestCopilotRefresh: function\(\) \{(?P<body>.*?)\n    \},\n\n    _update",
            text,
            re.S,
        )
        self.assertIsNotNone(match)
        body = match.group("body")
        self.assertIn("var self = this;", body)
        self.assertIn("self._update();", body)

    def test_usage_actions_row_is_reactive_for_nested_buttons(self):
        extension_path = (
            Path(__file__).resolve().parents[1]
            / "gnome-extension"
            / "quotahalo@local"
            / "extension.js"
        )
        text = extension_path.read_text(encoding="utf-8")
        match = re.search(
            r"function addUsageActionsControl\(.*?\) \{(?P<body>.*?)\n\}",
            text,
            re.S,
        )
        self.assertIsNotNone(match)
        body = match.group("body")
        self.assertNotIn("PopupBaseMenuItem({ reactive: false })", body)

    def test_force_refresh_writes_diagnostic_log_with_exception_details(self):
        with tempfile.TemporaryDirectory() as tmp:
            status_dir = Path(tmp) / "quotahalo"
            log_path = status_dir / "manual-refresh.log"
            claude_empty = qhs.ClaudeDataFetcher()._empty
            codex_empty = qhs.CodexDataFetcher._empty

            class ClaudeFetcher:
                def __init__(self):
                    self.data = claude_empty()

                def fetch_all(self, force=False):
                    return self.data

            class CodexFetcher:
                @staticmethod
                def _empty():
                    return codex_empty()

                def fetch(self, diagnostics=None):
                    raise RuntimeError("codex boom")

            original_status_dir = qhs.STATUS_DIR
            original_label_file = qhs.STATUS_LABEL_FILE
            original_json_file = qhs.STATUS_JSON_FILE
            original_log_file = getattr(qhs, "MANUAL_REFRESH_LOG_FILE", None)
            original_claude_fetcher = qhs.ClaudeDataFetcher
            original_codex_fetcher = qhs.CodexDataFetcher
            qhs.STATUS_DIR = status_dir
            qhs.STATUS_LABEL_FILE = status_dir / "usage-label.txt"
            qhs.STATUS_JSON_FILE = status_dir / "usage-status.json"
            qhs.MANUAL_REFRESH_LOG_FILE = log_path
            qhs.ClaudeDataFetcher = ClaudeFetcher
            qhs.CodexDataFetcher = CodexFetcher
            try:
                qhs.refresh_once(force=True)
            finally:
                qhs.STATUS_DIR = original_status_dir
                qhs.STATUS_LABEL_FILE = original_label_file
                qhs.STATUS_JSON_FILE = original_json_file
                qhs.MANUAL_REFRESH_LOG_FILE = original_log_file
                qhs.ClaudeDataFetcher = original_claude_fetcher
                qhs.CodexDataFetcher = original_codex_fetcher

            text = log_path.read_text(encoding="utf-8")
            self.assertIn("manual refresh started", text)
            self.assertIn("Codex refresh failed", text)
            self.assertIn("RuntimeError: codex boom", text)
            self.assertIn("ERROR", text)
            self.assertNotIn("traceback", text.lower())

    def test_background_refresh_does_not_write_manual_diagnostic_log(self):
        with tempfile.TemporaryDirectory() as tmp:
            status_dir = Path(tmp) / "quotahalo"
            log_path = status_dir / "manual-refresh.log"
            claude_empty = qhs.ClaudeDataFetcher()._empty
            codex_empty = qhs.CodexDataFetcher._empty

            class ClaudeFetcher:
                def __init__(self):
                    self.data = claude_empty()

                def fetch_all(self, force=False):
                    return self.data

            class CodexFetcher:
                @staticmethod
                def _empty():
                    return codex_empty()

                def fetch(self, diagnostics=None):
                    raise RuntimeError("background boom")

            original_status_dir = qhs.STATUS_DIR
            original_label_file = qhs.STATUS_LABEL_FILE
            original_json_file = qhs.STATUS_JSON_FILE
            original_log_file = getattr(qhs, "MANUAL_REFRESH_LOG_FILE", None)
            original_claude_fetcher = qhs.ClaudeDataFetcher
            original_codex_fetcher = qhs.CodexDataFetcher
            qhs.STATUS_DIR = status_dir
            qhs.STATUS_LABEL_FILE = status_dir / "usage-label.txt"
            qhs.STATUS_JSON_FILE = status_dir / "usage-status.json"
            qhs.MANUAL_REFRESH_LOG_FILE = log_path
            qhs.ClaudeDataFetcher = ClaudeFetcher
            qhs.CodexDataFetcher = CodexFetcher
            try:
                qhs.refresh_once(force=False)
            finally:
                qhs.STATUS_DIR = original_status_dir
                qhs.STATUS_LABEL_FILE = original_label_file
                qhs.STATUS_JSON_FILE = original_json_file
                qhs.MANUAL_REFRESH_LOG_FILE = original_log_file
                qhs.ClaudeDataFetcher = original_claude_fetcher
                qhs.CodexDataFetcher = original_codex_fetcher

            self.assertFalse(log_path.exists())

    def test_manual_refresh_log_is_capped_without_rotated_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "manual-refresh.log"
            original_limit = qhs.MANUAL_REFRESH_LOG_MAX_BYTES
            qhs.MANUAL_REFRESH_LOG_MAX_BYTES = 220
            try:
                diagnostics = qhs.ManualRefreshDiagnostics(enabled=True, path=log_path)
                for i in range(20):
                    diagnostics.log("cap test", index=i, payload="x" * 80)
            finally:
                qhs.MANUAL_REFRESH_LOG_MAX_BYTES = original_limit

            self.assertLessEqual(log_path.stat().st_size, 220)
            self.assertFalse(log_path.with_name("manual-refresh.log.1").exists())

    def test_manual_refresh_log_redacts_private_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "manual-refresh.log"
            diagnostics = qhs.ManualRefreshDiagnostics(enabled=True, path=log_path)
            diagnostics.log(
                "privacy test",
                path=Path.home() / ".codex" / "auth.json",
                email="person@example.com",
                access_token="sk-secret-token",
                nested={"refreshToken": "refresh-secret"},
                note="Authorization: Bearer abc.def.ghi",
            )

            text = log_path.read_text(encoding="utf-8")
            self.assertIn("privacy test", text)
            self.assertIn("path is", text)
            self.assertIn("~/.codex/auth.json", text)
            self.assertNotIn(str(Path.home()), text)
            self.assertNotIn("person@example.com", text)
            self.assertNotIn("sk-secret-token", text)
            self.assertNotIn("refresh-secret", text)
            self.assertNotIn("abc.def.ghi", text)
            self.assertIn("[REDACTED]", text)

    def test_manual_refresh_log_uses_timestamped_plain_language_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "manual-refresh.log"
            diagnostics = qhs.ManualRefreshDiagnostics(enabled=True, path=log_path)
            diagnostics.log(
                "Codex session scan started",
                codex_dir=Path.home() / ".codex",
                session_files=3,
                recent_files=[
                    {
                        "path": Path.home() / ".codex" / "sessions" / "one.jsonl",
                        "size": 123,
                    }
                ],
            )

            lines = [
                line for line in log_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertGreaterEqual(len(lines), 2)
            for line in lines:
                self.assertRegex(line, r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} (INFO|WARN|ERROR) ")
                self.assertNotIn("===", line)
                self.assertNotIn("{", line)
                self.assertNotIn("}", line)
                self.assertNotIn("T", line[:20])
                self.assertFalse(line.startswith(" "))
            self.assertIn("Codex session scan started.", lines[0])
            self.assertTrue(any("session files is 3" in line for line in lines))
            self.assertTrue(any("recent files item 1 path is" in line for line in lines))

    def test_manual_refresh_log_suppresses_debug_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "manual-refresh.log"
            diagnostics = qhs.ManualRefreshDiagnostics(enabled=True, path=log_path)
            diagnostics.log("visible info")
            diagnostics.log("hidden debug", level="DEBUG")

            text = log_path.read_text(encoding="utf-8")
            self.assertIn("INFO visible info.", text)
            self.assertNotIn("hidden debug", text)


if __name__ == "__main__":
    unittest.main()
