'use strict';

const si = require('systeminformation');

/**
 * Collect current system metrics.
 * @returns {Promise<{
 *   cpu: number, memory: number, memoryUsedMb: number, memoryTotalMb: number,
 *   disk: number, diskUsedGb: number, diskTotalGb: number,
 *   networkIn: number, networkOut: number,
 *   loadAvg1m: number, loadAvg5m: number, loadAvg15m: number,
 *   uptimeSeconds: number, timestamp: string
 * }>}
 */
async function collectMetrics() {
  const [load, mem, fsSizes, netStats, time] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.networkStats('*'),
    si.time(),
  ]);

  // CPU
  const cpu = load.currentLoad ?? 0;

  // Memory
  const memoryTotalMb = mem.total / 1024 / 1024;
  const memoryUsedMb  = mem.active / 1024 / 1024;
  const memory        = (mem.active / mem.total) * 100;

  // Disk — pick the entry with the largest total size (primary disk)
  const primaryDisk = fsSizes.reduce((best, fs) => {
    return (fs.size > (best?.size ?? 0)) ? fs : best;
  }, null);
  const diskTotalGb = primaryDisk ? primaryDisk.size  / 1024 / 1024 / 1024 : 0;
  const diskUsedGb  = primaryDisk ? primaryDisk.used  / 1024 / 1024 / 1024 : 0;
  const disk        = primaryDisk ? (primaryDisk.used / primaryDisk.size) * 100 : 0;

  // Network — sum all non-loopback interfaces
  const nonLoopback = netStats.filter(n => n.iface && !n.iface.startsWith('lo'));
  const networkIn   = nonLoopback.reduce((sum, n) => sum + (n.rx_sec ?? 0), 0);
  const networkOut  = nonLoopback.reduce((sum, n) => sum + (n.tx_sec ?? 0), 0);

  // Load averages and uptime from si.time()
  const loadAvg1m   = time.current ? 0 : 0; // si.time() doesn't expose loadavg
  const loadAvg5m   = 0;
  const loadAvg15m  = 0;
  // Use os module for load averages — more reliable
  const { loadavg, uptime } = require('os');
  const [la1, la5, la15]   = loadavg();
  const uptimeSeconds       = uptime();

  return {
    cpu:           Math.min(100, Math.max(0, cpu)),
    memory:        Math.min(100, Math.max(0, memory)),
    memoryUsedMb:  memoryUsedMb,
    memoryTotalMb: memoryTotalMb,
    disk:          Math.min(100, Math.max(0, disk)),
    diskUsedGb:    diskUsedGb,
    diskTotalGb:   diskTotalGb,
    networkIn:     Math.max(0, networkIn),
    networkOut:    Math.max(0, networkOut),
    loadAvg1m:     la1,
    loadAvg5m:     la5,
    loadAvg15m:    la15,
    uptimeSeconds: uptimeSeconds,
    timestamp:     new Date().toISOString(),
  };
}

module.exports = { collectMetrics };
