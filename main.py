import hashlib
import time
import json
import logging
import argparse
import requests
from urllib.parse import quote
from itertools import product
from pathlib import Path
import random
from typing import Any

DEFAULT_SALT = "Uiv#87#SPan.ECsp"

log = logging.getLogger(__name__)

class Exchanger:
    MAX_RETRIES = 5

    ERR_ALREADY_DONE = {40008, 20000}
    ERR_TIME_EXPIRED = 40004

    API_URL = "https://wjdr-giftcode-api.campfiregames.cn/api/gift_code"
    API_HEADERS = {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/x-www-form-urlencoded",
        "origin": "https://wjdr-giftcode.wjdr.cn",
        "referer": "https://wjdr-giftcode.wjdr.cn/",
        "user-agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0"
        ),
    }

    def __init__(self, record_file: str | Path, salt: str = DEFAULT_SALT):
        self.record_file = Path(record_file)
        self.salt = salt
        self._records = self._load_records()
        self._skipped = 0
        self._processed = 0

    def _load_records(self) -> dict[str, Any]:
        if self.record_file.exists():
            with self.record_file.open("r", encoding="utf-8") as f:
                return json.load(f)
        return {}

    def _save_records(self):
        with self.record_file.open("w", encoding="utf-8") as f:
            json.dump(self._records, f, ensure_ascii=False, indent=2)

    @staticmethod
    def _make_key(cdk: str, fid: str, kid: str) -> str:
        return f"{cdk}|{fid}|{kid}"

    def _build_sign(self, cdk: str, fid: str, kid: str, timestamp: int) -> str:
        cdk_encoded = quote(cdk, safe="")
        raw = f"cdk={cdk_encoded}&fid={fid}&kid={kid}&time={timestamp}{self.salt}"
        return hashlib.md5(raw.encode()).hexdigest()

    def _exchange_gift(self, cdk: str, fid: str, kid: str) -> dict[str, Any]:
        timestamp = int(time.time())
        sign = self._build_sign(cdk, fid, kid, timestamp)

        data = {
            "sign": sign,
            "fid": fid,
            "cdk": cdk,
            "kid": kid,
            "time": str(timestamp),
        }

        resp = requests.post(
            self.API_URL,
            data=data,
            headers=self.API_HEADERS,
        )
        return resp.json()

    def __call__(self, cdk_list: list[str], account_list: list[dict[str, str]]):
        for account, cdk in product(account_list, cdk_list):
            fid, kid, name = account["fid"], account["kid"], account["name"]
            key = self._make_key(cdk, fid, kid)

            if self._is_already_done(cdk, fid, kid):
                self._skipped += 1
                continue

            self._exchange_with_retry(key, cdk, fid, kid, name)

            time.sleep(random.randint(4, 10))

        log.info(
            f"Done. Skipped: {self._skipped}, Processed: {self._processed}"
        )

    def _is_already_done(self, cdk: str, fid: str, kid: str) -> bool:
        for record in self._records.get(cdk, []):
            if record["fid"] == fid and record["kid"] == kid:
                err_code = record.get("result", {}).get("err_code")
                if err_code in self.ERR_ALREADY_DONE:
                    key = self._make_key(cdk, fid, kid)
                    log.info(f"SKIP (already done): {key} -> {record}")
                    return True
                return False
        return False

    def _exchange_with_retry(self, key: str, cdk: str, fid: str, kid: str, name: str):
        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                result = self._exchange_gift(cdk, fid, kid)
                log.info(
                    f"[{attempt}/{self.MAX_RETRIES}] {key}|{name} -> {result}"
                )
                err_code = result.get("err_code")

                if err_code == self.ERR_TIME_EXPIRED:
                    log.warning("time Expired, retrying...")
                    time.sleep(random.randint(4, 10))
                    continue

                records = self._records.setdefault(cdk, [])
                target_idx = None
                for i, r in enumerate(records):
                    if r["fid"] == fid and r["kid"] == kid:
                        target_idx = i
                        break
                new_entry = {"kid": kid, "fid": fid, "result": result}
                if target_idx is not None:
                    records[target_idx] = new_entry
                else:
                    records.append(new_entry)
                self._save_records()
                self._processed += 1
                return
            except Exception as e:
                log.error(f"request error: {e}")
                time.sleep(1)

        log.error(
            f"FAILED after {self.MAX_RETRIES} retries: {key}"
        )

def main():
    script_dir = Path(__file__).parent
    parser = argparse.ArgumentParser(description="Gift code exchange tool")
    _ = parser.add_argument(
        "--accounts", "-a",
        default=str(script_dir / "accounts.json"),
        help="Path to accounts.json",
    )
    _ = parser.add_argument(
        "--records", "-r",
        default=str(script_dir / "records.json"),
        help="Path to records output file",
    )
    _ = parser.add_argument(
        "--log", "-l",
        default=str(script_dir / "log.log"),
        help="Path to log file",
    )
    _ = parser.add_argument(
        "--cdks", "-c",
        nargs="+",
        required=True,
        help="Gift codes to exchange, e.g. -c 'WJDR666' 'WJDR888'",
    )
    _ = parser.add_argument(
        "--salt", "-s",
        default=DEFAULT_SALT,
        help=f"Sign salt (default: {DEFAULT_SALT})",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(args.log, encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )

    with Path(args.accounts).open("r", encoding="utf-8") as f:
        accounts = json.load(f)

    exchanger = Exchanger(
        record_file=args.records,
        salt=args.salt,
    )
    exchanger(args.cdks, accounts)

if __name__ == "__main__":
    main()