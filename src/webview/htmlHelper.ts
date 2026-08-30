import * as vscode from 'vscode';

export function getWebviewContent(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js')
  );
  const stylesUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'styles.css')
  );
  const xtermCssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'xterm.css')
  );
  const codiconCssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'codicon.css')
  );

  // Generate a random nonce for CSP
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} https: data:;">
  <title>Dev Control Center</title>
  <link rel="stylesheet" href="${codiconCssUri}" />
  <link rel="stylesheet" href="${xtermCssUri}" />
  <link rel="stylesheet" href="${stylesUri}" />
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
