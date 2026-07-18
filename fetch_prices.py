
import json
import urllib.request
from datetime import datetime, timezone

# id -> (yahoo symbol, pre_start, cutoff, post_end)  dates yyyy-mm-dd
SCENARIOS = {
    "nvda-2022": ("NVDA",    "2021-11-01", "2022-10-14", "2022-11-14"),
    "btc-2017":  ("BTC-USD", "2017-01-01", "2017-12-17", "2018-01-16"),
    "aapl-2018": ("AAPL",    "2018-01-02", "2018-12-03", "2019-01-03"),
    "gme-2021":  ("GME",     "2020-06-01", "2021-01-27", "2021-02-26"),
    "meta-2022": ("META",    "2021-09-01", "2022-11-03", "2022-12-05"),
    "zm-2020":   ("ZM",      "2020-01-02", "2020-10-19", "2020-11-18"),
    "amzn-1999": ("AMZN",    "1998-06-01", "1999-12-10", "2000-02-10"),
    "csco-2000": ("CSCO",    "1998-10-01", "2000-03-27", "2000-04-27"),
    "nflx-2011": ("NFLX",    "2010-06-01", "2011-07-12", "2011-08-12"),
    "tsla-2019": ("TSLA",    "2018-06-01", "2019-06-03", "2019-07-03"),
    "spy-2020":  ("SPY",     "2019-06-01", "2020-03-23", "2020-04-23"),
}

def ts(d):
    return int(datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())

def fetch(symbol, d1, d2):
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
           f"?period1={ts(d1)}&period2={ts(d2) + 86400}&interval=1d")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    data = json.loads(urllib.request.urlopen(req).read())
    res = data["chart"]["result"][0]
    stamps = res["timestamp"]
    closes = res["indicators"]["quote"][0]["close"]
    out = []
    for t, c in zip(stamps, closes):
        if c is not None:
            day = datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%d")
            out.append((day, round(c, 4)))
    return out

def downsample(vals, n):
    if len(vals) <= n:
        return vals
    return [vals[round(i * (len(vals) - 1) / (n - 1))] for i in range(n)]

result = {}
for sid, (sym, d1, cutoff, d2) in SCENARIOS.items():
    series = fetch(sym, d1, d2)
    if not series:
        print(f"!! no data for {sid} ({sym})")
        continue
    pre = [c for d, c in series if d <= cutoff]
    post = [c for d, c in series if d > cutoff]
    post = [pre[-1]] + post  # continuation starts where pre ends
    pct = (post[-1] / pre[-1] - 1) * 100
    result[sid] = {
        "pre": downsample(pre, 120),
        "post": downsample(post, 24),
        "pct": round(pct, 1),
    }
    print(f"{sid}: {len(pre)} pre / {len(post)} post pts, outcome {pct:+.1f}%")

with open("prices.js", "w") as f:
    f.write("// Real historical daily closes (Yahoo Finance), baked at build time.\n")
    f.write("const REAL_PRICES = " + json.dumps(result) + ";\n")
print("wrote prices.js")

# ---- full histories for randomly generated mystery rounds ----
HISTORY_TICKERS = {
    "AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "Nvidia", "AMZN": "Amazon",
    "GOOGL": "Alphabet", "META": "Meta", "TSLA": "Tesla", "NFLX": "Netflix",
    "AMD": "AMD", "INTC": "Intel", "KO": "Coca-Cola", "MCD": "McDonald's",
    "DIS": "Disney", "BA": "Boeing", "JPM": "JPMorgan", "XOM": "ExxonMobil",
    "NKE": "Nike", "SBUX": "Starbucks", "SPY": "S&P 500", "BTC-USD": "Bitcoin",
}

TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
history = {}
for sym, name in HISTORY_TICKERS.items():
    try:
        series = fetch(sym, "1995-01-01", TODAY)
    except Exception as e:
        print(f"!! history failed for {sym}: {e}")
        continue
    dates = [int(d.replace("-", "")) for d, _ in series]
    closes = [round(c, 3) if c < 1000 else round(c, 1) for _, c in series]
    history[sym] = {"name": name, "dates": dates, "closes": closes}
    print(f"history {sym}: {len(closes)} pts ({dates[0]} -> {dates[-1]})")

with open("history.js", "w") as f:
    f.write("// Full daily close history per ticker (Yahoo Finance), for random rounds.\n")
    f.write("const HISTORY = " + json.dumps(history, separators=(",", ":")) + ";\n")
print("wrote history.js")
