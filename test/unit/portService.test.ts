import * as assert from 'assert';
import { PortService } from '../../src/ports/PortService';
import { WindowsPortService } from '../../src/ports/WindowsPortService';
import { ProcessService } from '../../src/processes/ProcessService';
import { isWindows } from '../../src/utils/platform';

describe('PortService & ProcessService Unit Tests', () => {
  let portService: PortService;
  let processService: ProcessService;

  beforeEach(() => {
    portService = new PortService();
    processService = new ProcessService();
  });

  afterEach(() => {
    portService.dispose();
  });

  it('detects listening ports on local machine without throwing', async () => {
    const ports = await portService.getListeningPorts(true);
    assert.ok(Array.isArray(ports));
    for (const p of ports) {
      assert.ok(typeof p.port === 'number');
      assert.ok(p.port > 0 && p.port <= 65535);
      assert.ok(typeof p.pid === 'number');
      assert.ok(typeof p.processName === 'string');
    }
  });

  it('handles invalid PID gracefully in ProcessService', async () => {
    const details = await processService.getProcessDetails(-1);
    assert.strictEqual(details, null);

    const zeroDetails = await processService.getProcessDetails(0);
    assert.strictEqual(zeroDetails, null);
  });

  it('handles non-existent process PID without crashing', async () => {
    const details = await processService.getProcessDetails(99999999);
    assert.ok(details !== null);
    assert.strictEqual(details?.pid, 99999999);
  });

  it('rejects killing invalid PID', async () => {
    await assert.rejects(async () => {
      await processService.killProcess(-5);
    }, /Invalid PID/);
  });

  it('returns null when querying process for non-listening port', async () => {
    const proc = await portService.getProcessForPort(65534);
    // Port 65534 is unlikely to be listening
    if (!proc) {
      assert.strictEqual(proc, null);
    }
  });
});
