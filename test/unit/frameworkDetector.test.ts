import * as assert from 'assert';
import { FrameworkDetector } from '../../src/ports/FrameworkDetector';

describe('FrameworkDetector Unit Tests', () => {
  it('detects Next.js on node with next in commandline', () => {
    const res = FrameworkDetector.detect('node.exe', 'node C:\\app\\node_modules\\next\\dist\\bin\\next dev', 3000);
    assert.strictEqual(res.runtime, 'node');
    assert.strictEqual(res.framework, 'Next.js');
  });

  it('detects Vite on node with vite in commandline', () => {
    const res = FrameworkDetector.detect('node.exe', 'node C:\\app\\node_modules\\vite\\bin\\vite.js', 5173);
    assert.strictEqual(res.runtime, 'node');
    assert.strictEqual(res.framework, 'Vite');
  });

  it('detects FastAPI with uvicorn in python commandline', () => {
    const res = FrameworkDetector.detect('python.exe', 'python -m uvicorn main:app --reload', 8000);
    assert.strictEqual(res.runtime, 'python');
    assert.strictEqual(res.framework, 'FastAPI');
  });

  it('detects Django with manage.py in commandline', () => {
    const res = FrameworkDetector.detect('python.exe', 'python manage.py runserver 0.0.0.0:8000', 8000);
    assert.strictEqual(res.runtime, 'python');
    assert.strictEqual(res.framework, 'Django');
  });

  it('detects PostgreSQL on port 5432', () => {
    const res = FrameworkDetector.detect('postgres.exe', '', 5432);
    assert.strictEqual(res.runtime, 'postgres');
    assert.strictEqual(res.framework, 'PostgreSQL');
  });

  it('detects Redis on port 6379', () => {
    const res = FrameworkDetector.detect('redis-server', '', 6379);
    assert.strictEqual(res.runtime, 'redis');
    assert.strictEqual(res.framework, 'Redis');
  });

  it('detects Spring Boot for Java', () => {
    const res = FrameworkDetector.detect('java.exe', 'java -jar app.jar org.springframework.boot', 8080);
    assert.strictEqual(res.runtime, 'java');
    assert.strictEqual(res.framework, 'Spring Boot');
  });

  it('falls back cleanly when framework is unknown without giving false information', () => {
    const res = FrameworkDetector.detect('custom-service.exe', 'custom-service run', 9999);
    assert.strictEqual(res.framework, undefined);
  });
});
