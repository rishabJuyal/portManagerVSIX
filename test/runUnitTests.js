require('./vscodeMock');
const Mocha = require('mocha');
const fs = require('fs');
const path = require('path');

const mocha = new Mocha({
  timeout: 10000,
  color: true
});

const testDir = path.join(__dirname, '..', 'dist-test');
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.js') || f.endsWith('.js'));

for (const file of files) {
  mocha.addFile(path.join(testDir, file));
}

mocha.run(failures => {
  process.exitCode = failures ? 1 : 0;
});
