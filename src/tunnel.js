const { spawn } = require('child_process');

let currentTunnelUrl = null;

function getTunnelUrl() {
  return currentTunnelUrl;
}

function startTunnel(port) {
  console.log('[Tunnel] Iniciando túnel público com localhost.run...');

  // Start SSH reverse tunnel to localhost.run
  // StrictHostKeyChecking=no automatically trusts the host key
  // ServerAliveInterval=60 prevents connection timeout
  // ExitOnForwardFailure=yes ensures the process ends if the port is busy
  const ssh = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=60',
    '-o', 'ExitOnForwardFailure=yes',
    '-R', `80:localhost:${port}`,
    'nokey@localhost.run'
  ]);

  ssh.stdout.on('data', (data) => {
    const output = data.toString();
    const match = output.match(/https:\/\/[a-z0-9]+\.lhr\.life/i);
    if (match) {
      currentTunnelUrl = match[0];
      console.log(`\n🌐 TÚNEL ONLINE: ${currentTunnelUrl}`);
      console.log(`📡 Feed público online: ${currentTunnelUrl}/feed/{userId}.xml\n`);
    }
  });

  ssh.stderr.on('data', (data) => {
    const errStr = data.toString().trim();
    if (errStr) {
      if (errStr.includes('denied') || errStr.includes('failed') || errStr.includes('Error')) {
        console.error(`[Tunnel Debug] ${errStr}`);
      }
    }
  });

  ssh.on('close', (code) => {
    console.log(`[Tunnel] Conexão encerrada (código ${code}). Reiniciando túnel em 5 segundos...`);
    currentTunnelUrl = null;
    setTimeout(() => startTunnel(port), 5000);
  });

  ssh.on('error', (err) => {
    console.error('[Tunnel] Erro no processo SSH:', err.message);
  });
}

module.exports = { startTunnel, getTunnelUrl };
