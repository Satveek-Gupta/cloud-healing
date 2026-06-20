'use strict';

const si = require('systeminformation');

/**
 * @typedef {{ pid: number, name: string, cpu: number, mem: number }} ProcessInfo
 */

/**
 * Collect process health information.
 * @returns {Promise<{
 *   total: number,
 *   running: number,
 *   crashed: ProcessInfo[],
 *   highCpu: ProcessInfo[],
 *   highMemory: ProcessInfo[],
 *   report: string
 * }>}
 */
async function collectProcesses() {
  const result = await si.processes();
  const list   = result.list ?? [];

  const total   = list.length;
  const running = list.filter(p => p.state === 'running').length;

  const crashed = list
    .filter(p => p.state === 'zombie' || p.state === 'stopped')
    .map(p => ({ pid: p.pid, name: p.name, cpu: p.cpu, mem: p.mem }));

  const highCpu = list
    .filter(p => p.cpu > 50)
    .map(p => ({ pid: p.pid, name: p.name, cpu: p.cpu, mem: p.mem }));

  const highMemory = list
    .filter(p => p.mem > 40)
    .map(p => ({ pid: p.pid, name: p.name, cpu: p.cpu, mem: p.mem }));

  const lines = [
    `Total processes: ${total} | Running: ${running}`,
    crashed.length > 0
      ? `Crashed/Zombie: ${crashed.map(p => `${p.name}(${p.pid})`).join(', ')}`
      : 'No crashed processes',
    highCpu.length > 0
      ? `High CPU (>50%): ${highCpu.map(p => `${p.name}(${p.cpu.toFixed(1)}%)`).join(', ')}`
      : 'No high-CPU processes',
    highMemory.length > 0
      ? `High Mem (>40%): ${highMemory.map(p => `${p.name}(${p.mem.toFixed(1)}%)`).join(', ')}`
      : 'No high-memory processes',
  ];

  return {
    total,
    running,
    crashed,
    highCpu,
    highMemory,
    report: lines.join('\n'),
  };
}

module.exports = { collectProcesses };
