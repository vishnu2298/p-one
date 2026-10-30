from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def test_blocks_advance_payment_scam():
    r = client.post("/moderate", json={"text": "Send advance payment via gift card and I will ship"}).json()
    assert r["allowed"] is False
    assert "advance_payment" in r["flags"]


def test_allows_normal_listing():
    r = client.post("/moderate", json={"text": "iPhone 15, excellent condition, with box"}).json()
    assert r["allowed"] is True and r["flags"] == []


def test_otp_request_blocked():
    assert client.post("/moderate", json={"text": "please share your OTP to confirm"}).json()["allowed"] is False


def test_price_hint_ignores_outliers():
    r = client.post("/price-hint", json={"category": "electronics", "prices": [1000, 1200, 1100, 1300, 900, 5000000]}).json()
    assert r["available"] and r["high"] < 2000


def test_price_hint_needs_data():
    assert client.post("/price-hint", json={"category": "x", "prices": [1]}).json()["available"] is False
