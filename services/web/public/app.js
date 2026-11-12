// Paste and Scan page. It only talks to our own routes on the same origin (README.md, "API").
// Safe DOM only: text goes in with textContent and never as HTML.
(function startPasteAndScan(GK, doc, win) {
  'use strict';

  const LAST_JOB_KEY = 'gk.lastJob';
  const byId = (id) => doc.getElementById(id);

  const ui = {
    form: byId('scan-form'),
    code: byId('code'),
    filename: byId('filename'),
    access: byId('access'),
    size: byId('size-hint'),
    scan: byId('scan-btn'),
    formError: byId('form-error'),
    loadRisky: byId('load-risky'),
    loadClean: byId('load-clean'),
    empty: byId('slip-empty'),
    lastScan: byId('last-scan'),
    status: byId('slip-status'),
    statusText: byId('status-text'),
    statusClock: byId('status-clock'),
    checkAgain: byId('check-again'),
    result: byId('slip-result'),
    problem: byId('slip-problem'),
    problemText: byId('problem-text'),
    live: byId('live'),
    recentTable: byId('recent-table'),
    recentBody: byId('recent-body'),
    recentNote: byId('recent-note'),
    refreshRecent: byId('refresh-recent'),
  };

  let tracking = null;
  let lastJobId = null;

  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function showPanel(panel) {
    for (const each of [ui.empty, ui.status, ui.result, ui.problem]) each.hidden = each !== panel;
  }

  function announce(message) {
    ui.live.textContent = '';
    win.setTimeout(() => {
      ui.live.textContent = message;
    }, 50);
  }

  async function getJson(path) {
    const response = await win.fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store' });
    let body = null;
    try {
      body = await response.json();
    } catch (ignored) {
      body = null;
    }
    return { code: response.status, body };
  }

  // ---------- the paste form ----------
  function updateSize() {
    const bytes = GK.codeBytes(ui.code.value);
    ui.size.textContent = `${GK.formatKB(bytes)} of 100 KB`;
    ui.size.classList.toggle('over', bytes > GK.MAX_CODE_BYTES);
  }

  function clearFormError() {
    ui.formError.hidden = true;
    ui.formError.textContent = '';
    for (const input of [ui.code, ui.filename, ui.access]) input.removeAttribute('aria-invalid');
  }

  function showFormError(message, field) {
    clearFormError();
    ui.formError.textContent = message;
    ui.formError.hidden = false;
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    }
  }

  function submitMessage(code, body) {
    if (code === 401) return 'That access code is not right. Check it with the GateKeeper team.';
    if (code === 413) return 'This paste is over 100 KB. Paste a smaller part.';
    if (code === 429) return 'Too many scans at once. Wait a few seconds, then scan again.';
    if (code === 503) return 'The scan queue is busy. Scan again in a moment.';
    if (body && typeof body.message === 'string') return body.message;
    return `GateKeeper answered with status ${code}. Scan again in a moment.`;
  }

  function loadSample(templateId, filename) {
    ui.code.value = `${byId(templateId).content.textContent.trim()}\n`;
    ui.filename.value = filename;
    updateSize();
    clearFormError();
    ui.code.focus();
  }

  async function onSubmit(event) {
    event.preventDefault();
    clearFormError();
    const code = ui.code.value;
    const filename = ui.filename.value.trim() || 'snippet.js';
    const accessCode = ui.access.value;
    if (!code.trim()) return showFormError('Paste some JavaScript first.', ui.code);
    if (GK.codeBytes(code) > GK.MAX_CODE_BYTES) return showFormError('This paste is over 100 KB. Paste a smaller part.', ui.code);
    if (!GK.isFilename(filename)) {
      return showFormError('Use a file name like app.js: letters, digits, dots, dashes or underscores, ending in .js, .mjs or .cjs.', ui.filename);
    }
    if (!accessCode) return showFormError('Enter the access code from the GateKeeper team.', ui.access);

    ui.scan.disabled = true;
    ui.scan.textContent = 'Sending code';
    try {
      const response = await win.fetch('/scans', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-demo-code': accessCode },
        body: JSON.stringify({ code, filename }),
      });
      let body = null;
      try {
        body = await response.json();
      } catch (ignored) {
        body = null;
      }
      if (response.status === 202 && body && GK.isJobId(body.jobId)) {
        rememberJob(body.jobId);
        startTracking(body.jobId);
        return undefined;
      }
      return showFormError(submitMessage(response.status, body), response.status === 401 ? ui.access : null);
    } catch (networkProblem) {
      return showFormError('GateKeeper could not be reached. Check your connection, then scan again.', null);
    } finally {
      ui.scan.disabled = false;
      ui.scan.textContent = 'Scan code';
    }
  }

  // ---------- following one scan ----------
  function rememberJob(jobId) {
    const url = new URL(win.location.href);
    url.searchParams.set('job', jobId);
    win.history.replaceState(null, '', url);
    try {
      win.localStorage.setItem(LAST_JOB_KEY, jobId);
    } catch (ignored) {
      // Storage can be turned off in private windows. The link in the address bar still works.
    }
  }

  function readLastJob() {
    try {
      const value = win.localStorage.getItem(LAST_JOB_KEY);
      return GK.isJobId(value) ? value : null;
    } catch (ignored) {
      return null;
    }
  }

  function stopTracking() {
    if (tracking && tracking.timer) win.clearTimeout(tracking.timer);
    tracking = null;
  }

  function startTracking(jobId) {
    stopTracking();
    lastJobId = jobId;
    tracking = { jobId, startedAt: Date.now(), timer: 0 };
    ui.checkAgain.hidden = true;
    ui.statusText.textContent = 'Code received. Waiting for the first update.';
    ui.statusClock.textContent = '0 s';
    ui.status.dataset.phase = 'QUEUED';
    showPanel(ui.status);
    poll(tracking);
  }

  function showProblem(message) {
    ui.problemText.textContent = message;
    showPanel(ui.problem);
    announce(message);
  }

  async function poll(current) {
    if (tracking !== current) return;
    let status = null;
    try {
      const { code, body } = await getJson(`/scans/${encodeURIComponent(current.jobId)}`);
      if (tracking !== current) return;
      if (code === 404) {
        stopTracking();
        showProblem('This link has no scan. Pasted code is kept for one day, so the scan may have expired.');
        return;
      }
      if (code === 200 && body) status = body;
    } catch (ignored) {
      // A short network drop: keep the schedule and try again on the next tick.
    }
    if (tracking !== current) return;

    const elapsed = Date.now() - current.startedAt;
    ui.statusClock.textContent = `${Math.round(elapsed / 1000)} s`;
    if (status) {
      ui.statusText.textContent = GK.statusLine(status);
      ui.status.dataset.phase = status.phase;
      if (status.phase === 'DONE') {
        stopTracking();
        await showResult(status);
        return;
      }
    }
    if (!GK.shouldKeepPolling(elapsed, status ? status.phase : 'QUEUED')) {
      stopTracking();
      ui.statusText.textContent = 'Still scanning after 2 minutes. Check again to keep waiting.';
      ui.checkAgain.hidden = false;
      announce('Still scanning after 2 minutes.');
      return;
    }
    current.timer = win.setTimeout(() => poll(current), GK.pollDelayMs(elapsed));
  }

  // ---------- the inspection slip ----------
  async function showResult(status) {
    let report = null;
    if (status.hasReport) {
      try {
        const { code, body } = await getJson(`/scans/${encodeURIComponent(status.jobId)}/report`);
        if (code === 200 && body) report = body;
      } catch (ignored) {
        report = null;
      }
    }
    renderResult(status, report);
    loadRecent();
  }

  function renderResult(status, report) {
    const info = GK.verdictInfo(status.verdict);
    const stamp = el('p', `stamp stamp-${info.tone}`, info.label);
    const verdict = el('div', 'verdict');
    verdict.append(stamp, el('p', 'verdict-summary', info.summary));

    const parts = [verdict, countsBlock(status.counts), subjectBlock(status, report)];
    if (report) {
      parts.push(findingsBlock(Array.isArray(report.findings) ? report.findings : []));
      if (Array.isArray(report.skippedFiles) && report.skippedFiles.length > 0) parts.push(skippedBlock(report.skippedFiles));
    } else if (status.verdict === 'INCOMPLETE') {
      parts.push(el('p', 'quiet', 'No report was saved for this scan. Scan the code again to get one.'));
    } else {
      parts.push(el('p', 'quiet', 'The full report could not be loaded. Reload the page to try again.'));
    }
    parts.push(shareBlock(status.jobId));

    ui.result.replaceChildren(...parts);
    showPanel(ui.result);
    announce(`Scan finished: ${info.label}, ${GK.countsLine(status.counts)}.`);
    win.requestAnimationFrame(() => stamp.classList.add('stamp-land'));
  }

  function countsBlock(counts) {
    const list = el('dl', 'counts');
    const c = counts || {};
    for (const [key, label] of [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]) {
      const value = Number(c[key]) || 0;
      const item = el('div', `count count-${key}`);
      if (value > 0) item.classList.add('has');
      item.append(el('dt', null, label), el('dd', null, value));
      list.append(item);
    }
    return list;
  }

  function subjectBlock(status, report) {
    const line = el('p', 'subject');
    if (status.source === 'pr' && GK.isRepoName(status.repo) && Number.isInteger(status.prNumber)) {
      const link = el('a', null, `Pull request #${status.prNumber}`);
      link.href = `https://github.com/${status.repo}/pull/${status.prNumber}`;
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      line.append(link, doc.createTextNode(` in ${status.repo}, commit `), el('code', null, GK.shortSha(status.headSha)));
    } else {
      line.append(doc.createTextNode('File '), el('code', null, status.filename || 'snippet.js'));
    }
    const when = report && report.scannedAt ? report.scannedAt : status.updatedAt;
    if (when) line.append(doc.createTextNode(`, scanned ${GK.timeAgo(when, Date.now())}.`));
    return line;
  }

  function findingsBlock(findings) {
    const wrap = el('div', 'findings-wrap');
    wrap.append(el('h3', null, findings.length === 1 ? '1 finding' : `${findings.length} findings`));
    if (findings.length === 0) {
      wrap.append(el('p', 'quiet', 'Nothing to fix. The scanner found no problems.'));
      return wrap;
    }
    const list = el('ol', 'findings');
    for (const finding of findings) {
      const item = el('li', `finding sev-${GK.severityTone(finding.severity)}`);
      const head = el('p', 'finding-head');
      head.append(
        el('span', 'sev', GK.severityLabel(finding.severity)),
        el('strong', null, finding.name || finding.id),
        el('span', 'where', `${finding.file || 'file'}:${finding.line || '?'}`),
      );
      item.append(head);
      if (finding.description) item.append(el('p', 'finding-what', finding.description));
      if (finding.evidence) {
        const pre = el('pre', 'evidence');
        pre.append(el('code', null, finding.evidence));
        item.append(pre);
      }
      if (finding.message) item.append(el('p', 'finding-fix', `How to fix: ${finding.message}`));
      list.append(item);
    }
    wrap.append(list);
    return wrap;
  }

  function skippedBlock(skipped) {
    const wrap = el('div', 'skipped');
    wrap.append(el('h3', null, 'Not scanned'));
    const list = el('ul', null);
    for (const file of skipped) list.append(el('li', null, `${file.path}: ${String(file.reason || '').replace(/_/g, ' ')}`));
    wrap.append(list);
    return wrap;
  }

  function shareBlock(jobId) {
    const wrap = el('div', 'share');
    const label = el('label', null, 'Link to this report');
    label.htmlFor = 'share-link';
    const input = el('input', null);
    input.id = 'share-link';
    input.readOnly = true;
    input.value = `${win.location.origin}${win.location.pathname}?job=${jobId}`;
    const button = el('button', 'quiet-button', 'Copy link');
    button.type = 'button';
    button.addEventListener('click', async () => {
      try {
        await win.navigator.clipboard.writeText(input.value);
        button.textContent = 'Copied';
      } catch (ignored) {
        input.select();
        button.textContent = 'Press Ctrl+C';
      }
    });
    const row = el('div', 'share-row');
    row.append(input, button);
    wrap.append(label, row);
    return wrap;
  }

  // ---------- recent pull request checks ----------
  function cell(label, text, extraClass) {
    const td = el('td', extraClass || null, text);
    td.dataset.label = label;
    return td;
  }

  function verdictCell(item) {
    const td = el('td', null);
    td.dataset.label = 'Result';
    if (item.phase === 'DONE' && item.verdict) {
      const info = GK.verdictInfo(item.verdict);
      td.append(el('span', `chip chip-${info.tone}`, info.label));
    } else {
      td.append(el('span', 'chip chip-wait', item.phase === 'FAILED' ? 'RETRYING' : 'SCANNING'));
    }
    return td;
  }

  function openCell(jobId) {
    const td = el('td', 'open');
    td.dataset.label = 'Report';
    if (GK.isJobId(jobId)) {
      const link = el('a', null, 'Open');
      link.href = `?job=${jobId}`;
      td.append(link);
    }
    return td;
  }

  function renderRecent(items) {
    ui.recentBody.replaceChildren();
    if (items.length === 0) {
      ui.recentTable.hidden = true;
      ui.recentNote.textContent = 'No pull request checks yet. Open a pull request in the demo repository to see one here.';
      ui.recentNote.hidden = false;
      return;
    }
    const now = Date.now();
    for (const item of items) {
      const row = el('tr', null);
      row.append(
        cell('Pull request', `#${item.prNumber}`),
        cell('Commit', GK.shortSha(item.headSha), 'mono'),
        verdictCell(item),
        cell('Findings', item.counts ? GK.countsLine(item.counts) : 'not yet'),
        cell('When', GK.timeAgo(item.createdAt, now)),
        openCell(item.jobId),
      );
      ui.recentBody.append(row);
    }
    ui.recentTable.hidden = false;
    ui.recentNote.hidden = true;
  }

  async function loadRecent() {
    try {
      const { code, body } = await getJson('/scans');
      if (code !== 200 || !body || !Array.isArray(body.items)) throw new Error('unexpected list');
      renderRecent(body.items);
    } catch (ignored) {
      ui.recentTable.hidden = true;
      ui.recentNote.textContent = 'Recent checks are not available right now.';
      ui.recentNote.hidden = false;
    }
  }

  // ---------- start ----------
  ui.form.addEventListener('submit', onSubmit);
  ui.code.addEventListener('input', updateSize);
  ui.loadRisky.addEventListener('click', () => loadSample('sample-risky', 'demo.js'));
  ui.loadClean.addEventListener('click', () => loadSample('sample-clean', 'cart.js'));
  ui.checkAgain.addEventListener('click', () => {
    if (lastJobId) startTracking(lastJobId);
  });
  ui.refreshRecent.addEventListener('click', loadRecent);
  updateSize();

  const fromLink = new URLSearchParams(win.location.search).get('job');
  if (GK.isJobId(fromLink)) {
    startTracking(fromLink);
  } else {
    const previous = readLastJob();
    if (previous) {
      ui.lastScan.hidden = false;
      ui.lastScan.addEventListener('click', () => {
        rememberJob(previous);
        startTracking(previous);
      });
    }
  }
  loadRecent();
})(globalThis.GK, document, window);
