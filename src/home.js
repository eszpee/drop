// "Home mode": the visitor reaches the internet through the same router as this
// server, which in practice means the owner, at home or on the home Tailscale exit
// node. The server does not know its own public address (it sits behind NAT), so
// it asks an outside service what address its requests arrive from and compares
// that with the visitor's.
//
// Nothing runs in the background. A visitor whose address matches the last known
// one is home with no lookup at all. A mismatch is either a stranger or a changed
// home address, so it triggers a fresh lookup, at most once per recheck interval:
// strangers cannot drive more lookups than that. When a lookup fails, the last
// known address stays; with none known yet, nobody is home.

export function parseTrace(text) {
  const m = /^ip=(.+)$/m.exec(text);
  return m ? m[1].trim() : null;
}

export class HomeDetector {
  constructor({ lookupUrl, recheckMs, fetchImpl = fetch, now = Date.now }) {
    this.lookupUrl = lookupUrl;
    this.recheckMs = recheckMs;
    this.fetch = fetchImpl;
    this.now = now;
    this.ip = null;
    this.checkedAt = -Infinity;
    this.inflight = null;
  }

  get enabled() {
    return Boolean(this.lookupUrl);
  }

  async isHome(ip) {
    if (!this.enabled || !ip) return false;
    if (this.ip && ip === this.ip) return true;
    if (!this.inflight) {
      if (this.now() - this.checkedAt < this.recheckMs) return false;
      this.checkedAt = this.now();
      this.inflight = this.lookup().finally(() => {
        this.inflight = null;
      });
    }
    await this.inflight;
    return ip === this.ip;
  }

  async lookup() {
    try {
      const res = await this.fetch(this.lookupUrl, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      const ip = parseTrace(await res.text());
      if (!ip) throw new Error('no ip= line in the answer');
      if (ip !== this.ip) console.log(`home address is now ${ip}${this.ip ? ` (was ${this.ip})` : ''}`);
      this.ip = ip;
    } catch (err) {
      console.error(`home address lookup failed, keeping ${this.ip ?? 'none'}: ${err.message}`);
    }
  }
}
