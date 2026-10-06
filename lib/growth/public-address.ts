/** An address no public picture lives at: loopback, private, link-local, carrier-grade NAT, unique-local, multicast, unspecified, or an IPv6 form that wraps an IPv4. */
export function privateAddress(ip: string): boolean {
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
  }
  const v6 = ip.toLowerCase();
  /* A mapped IPv4 written in hex hides the address: refused rather than decoded. */
  /* IPv4-compatible (`::7f00:1`), NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`) carry an IPv4 inside: refused too. */
  return v6 === "::" || v6 === "::1" || v6.startsWith("::ffff:") || /^::[0-9a-f]/.test(v6) || v6.startsWith("64:ff9b:") || v6.startsWith("2002:") || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6);
}
