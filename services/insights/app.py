"""Connectly insights service.

Supporting service for the Node API:
  * POST /moderate    - flags scam / unsafe text in listings and chat.
  * POST /price-hint  - suggests a fair price range from comparable listings.

The Node API treats this service as optional and falls back safely when it is down.
"""
import re
import statistics
from typing import List

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="Connectly Insights", version="1.0.0")

# (flag, pattern, blocks_listing)
RULES = [
    ("advance_payment", r"\b(advance|token)\s+(payment|amount|money)\b|\bpay\s+(first|in advance)\b", True),
    ("untraceable_payment", r"\b(western\s*union|moneygram|gift\s*card|bitcoin|crypto\s*(payment|only))\b", True),
    ("otp_or_credentials", r"\b(share|send|give|tell)\b.{0,25}\b(otp|pin|cvv|password|card\s*number)\b", True),
    ("off_platform_wallet", r"\b(upi\s*id|google\s*pay|gpay|phonepe|paytm)\b.{0,20}\b(first|before|advance)\b", True),
    ("phishing_link", r"https?://\S*(bit\.ly|tinyurl|t\.co)\S*", False),
    ("army_scam", r"\b(army|cisf|crpf)\s+(officer|personnel|transfer)\b", True),
]
COMPILED = [(f, re.compile(p, re.I | re.S), block) for f, p, block in RULES]


class ModerateIn(BaseModel):
    text: str = Field(default="", max_length=5000)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/moderate")
def moderate(body: ModerateIn):
    flags = [f for f, rx, _ in COMPILED if rx.search(body.text)]
    blocking = [f for f, rx, block in COMPILED if block and rx.search(body.text)]
    return {
        "allowed": not blocking,
        "flags": flags,
        "reason": "This listing asks for advance payment or personal codes, which is a common scam. Please remove it and try again."
        if blocking
        else None,
        "source": "insights",
    }


class PriceIn(BaseModel):
    category: str
    title: str = ""
    prices: List[int] = []


def _quantile(sorted_vals: List[int], q: float) -> float:
    idx = (len(sorted_vals) - 1) * q
    lo, hi = int(idx), min(int(idx) + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (idx - lo)


@app.post("/price-hint")
def price_hint(body: PriceIn):
    prices = sorted(p for p in body.prices if p > 0)
    if len(prices) < 3:
        return {"available": False, "reason": "Not enough similar items yet", "source": "insights"}
    # Trim outliers using the IQR rule so one luxury listing doesn't skew the range.
    q1, q3 = _quantile(prices, 0.25), _quantile(prices, 0.75)
    iqr = q3 - q1
    kept = [p for p in prices if q1 - 1.5 * iqr <= p <= q3 + 1.5 * iqr] or prices
    return {
        "available": True,
        "low": int(_quantile(kept, 0.25)),
        "median": int(statistics.median(kept)),
        "high": int(_quantile(kept, 0.75)),
        "sample": len(kept),
        "source": "insights",
    }
