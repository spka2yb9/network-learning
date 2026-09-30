import { NetworkSimulator } from '../simulator/core/NetworkSimulator';
import type { NetworkSnapshot } from '../simulator/core/types';
import type { CheckResult } from './types';

/** Every check runs on a cold, isolated copy: grading never changes the learner's workspace. */
export function grader(snapshot: NetworkSnapshot) {
  const n = NetworkSimulator.fromSnapshot(snapshot);
  const results: CheckResult[] = [];
  const check = (label: string, fn: (n: NetworkSimulator) => boolean) => {
    let pass = false;
    try { pass = fn(NetworkSimulator.fromSnapshot(snapshot)); } catch { pass = false; }
    results.push({ label, pass });
  };
  return {
    n, results, check,
    ping: (label: string, from: string, to: string, expect = true) => check(label, x => x.ping(from, to).success === expect),
    http: (label: string, from: string, url: string, expect = true, insecure = false) => check(label, x => x.http(from, url, { insecure }).success === expect),
    tcp: (label: string, from: string, host: string, port: number, expect = true) => check(label, x => x.tcpConnect(from, host, port).success === expect),
    dns: (label: string, from: string, name: string, expected: string) => check(label, x => !!x.dnsLookup(from, name).message?.answer.some(a => a.value === expected)),
    done: () => results,
  };
}
