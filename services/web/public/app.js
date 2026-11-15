// the console page
// it only talks to our own routes on the same site
// safe DOM only
// text goes in as text and never as HTML
(function startConsole(GK, doc, win) {
  'use strict';

  const LAST_JOB_KEY = 'gk.lastJob';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DONUT_R = 48;
  const DONUT_C = 2 * Math.PI * DONUT_R;
  const LOG_MAX = 40;
  const byId = (id) => doc.getElementById(id);

  const ui = {
    envPill: byId('env-pill'),
    envText: byId('env-text'),
    pipeline: byId('pipeline'),
    activity: byId('activity'),
    readPolls: byId('read-polls'),
    ctaScan: byId('cta-scan'),
    pipeChip: byId('pipe-chip'),
    pipeCaption: byId('pipe-caption'),
    statScan: byId('stat-scan'),
    statScanNote: byId('stat-scan-note'),
    statFindings: byId('stat-findings'),
    statFindingsNote: byId('stat-findings-note'),
    statTime: byId('stat-time'),
    statTimeNote: byId('stat-time-note'),
    statPr: byId('stat-pr'),
    statPrNote: byId('stat-pr-note'),
    form: byId('scan-form'),
    code: byId('code'),
    gutter: byId('gutter'),
    filename: byId('filename'),
    size: byId('size-hint'),
    access: byId('access'),
    toggleAccess: byId('toggle-access'),
    scan: byId('scan-btn'),
    scanLabel: byId('scan-label'),
    kbd: byId('kbd-hint'),
    formError: byId('form-error'),
    loadRisky: byId('load-risky'),
    loadClean: byId('load-clean'),
    localTests: byId('local-tests'),
    loadRetry: byId('load-retry'),
    loadIncomplete: byId('load-incomplete'),
    loadSlow: byId('load-slow'),
    openFile: byId('open-file'),
    fileInput: byId('file-input'),
    clearCode: byId('clear-code'),
    actChip: byId('act-chip'),
    empty: byId('act-empty'),
    lastScan: byId('last-scan'),
    live: byId('act-live'),
    problem: byId('act-problem'),
    problemText: byId('problem-text'),
    jobId: byId('job-id'),
    copyJob: byId('copy-job'),
    traceId: byId('trace-id'),
    tryText: byId('try-text'),
    statusClock: byId('status-clock'),
    pollCount: byId('poll-count'),
    statusText: byId('status-text'),
    checkAgain: byId('check-again'),
    stopWatch: byId('stop-watch'),
    viewReport: byId('view-report'),
    logLines: byId('log-lines'),
    reportLog: byId('report-log'),
    scanLog: byId('scan-log'),
    scanFacts: byId('scan-facts'),
    reportSub: byId('report-sub'),
    reportEmpty: byId('report-empty'),
    reportBody: byId('report-body'),
    verdict: byId('verdict'),
    verdictMark: byId('verdict-mark'),
    verdictTitle: byId('verdict-title'),
    verdictText: byId('verdict-text'),
    verdictGate: byId('verdict-gate'),
    donut: byId('donut'),
    donutTotal: byId('donut-total'),
    donutLabel: byId('donut-label'),
    countHigh: byId('count-high'),
    countMedium: byId('count-medium'),
    countLow: byId('count-low'),
    sevList: byId('sev-list'),
    subject: byId('subject'),
    findingsTitle: byId('findings-title'),
    filters: byId('filters'),
    findings: byId('findings'),
    findingsEmpty: byId('findings-empty'),
    findingsCap: byId('findings-cap'),
    skipped: byId('skipped'),
    skippedList: byId('skipped-list'),
    shareLink: byId('share-link'),
    copyLink: byId('copy-link'),
    refreshRecent: byId('refresh-recent'),
    recentTable: byId('recent-table'),
    recentBody: byId('recent-body'),
    recentNote: byId('recent-note'),
    announcer: byId('live'),
  };

  const DEFAULT_REPORT_SUB = ui.reportSub.textContent;
  // notes under the 3 counts
  // we keep them so we can put them back
  const SEV_NOTES = [...doc.querySelectorAll('.sev-note')].map((node) => [node, node.textContent]);
  let tracking = null;
  let lastJobId = null;
  let view = { mode: 'idle' };
  let findings = [];
  let hasReport = false;
  let filter = 'all';
  let gutterCount = 0;
  let reportCounts = null;
  let lastVerdict = null;

  // small helpers
  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  // icon from the sprite in the page html
  function icon(name) {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('aria-hidden', 'true');
    const use = doc.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  function announce(message) {
    ui.announcer.textContent = '';
    win.setTimeout(() => {
      ui.announcer.textContent = message;
    }, 50);
  }

  // ms is the round trip seen by this browser so a cold start shows here
  async function getJson(path) {
    const started = Date.now();
    const response = await win.fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store' });
    let body = null;
    try {
      body = await response.json();
    } catch (ignored) {
      body = null;
    }
    return { code: response.status, body, ms: Date.now() - started };
  }

  function setChip(node, info) {
    node.textContent = info.label;
    node.dataset.tone = info.tone;
  }

  // change only the text part of a button with an icon
  function setButtonText(button, text) {
    const last = button.lastChild;
    if (last && last.nodeType === 3) last.nodeValue = text;
  }

  async function copyText(text, onDone) {
    try {
      await win.navigator.clipboard.writeText(text);
      onDone(true);
    } catch (ignored) {
      onDone(false);
    }
  }

  // client log of what this page asked AWS
  function resetLog() {
    ui.logLines.replaceChildren();
    ui.reportLog.replaceChildren();
  }

  // ms is how long the request took in this browser and not a number from AWS
  function addLog(text, tone, ms) {
    // same line again like a 503 on every poll so count it and keep one line
    const last = ui.logLines.lastElementChild;
    if (last && last.dataset.text === text) {
      const count = (Number(last.dataset.count) || 1) + 1;
      for (const node of [last, ui.reportLog.lastElementChild]) {
        if (!node || node.dataset.text !== text) continue;
        node.dataset.count = String(count);
        node.querySelector('time').textContent = GK.clockTime(Date.now());
        const textPart = node.querySelector('.log-text');
        const badge = textPart.querySelector('.count') || textPart.appendChild(el('span', 'count'));
        badge.textContent = ` ×${count}`;
        const took = node.querySelector('.ms');
        if (took && Number.isFinite(ms)) took.textContent = GK.latencyText(ms);
      }
      return;
    }
    const line = el('li');
    line.dataset.text = text;
    if (tone) line.dataset.tone = tone;
    const { verb, rest } = GK.splitLogText(text);
    const body = el('span', 'log-text');
    if (verb) {
      const chip = el('b', 'verb', verb);
      chip.dataset.verb = verb;
      body.append(chip, ` ${rest}`);
    } else {
      body.textContent = rest;
    }
    line.append(el('time', null, GK.clockTime(Date.now())), body);
    if (Number.isFinite(ms)) line.append(el('span', 'ms', GK.latencyText(ms)));
    // a copy of the same line also goes to the Scan log in the report
    for (const [list, node] of [[ui.logLines, line], [ui.reportLog, line.cloneNode(true)]]) {
      list.append(node);
      while (list.children.length > LOG_MAX) list.firstElementChild.remove();
      list.scrollTop = list.scrollHeight;
    }
  }

  // when the log opens jump to the newest line
  function scrollReportLog() {
    ui.reportLog.scrollTop = ui.reportLog.scrollHeight;
  }

  function toneOf(status) {
    if (status.phase === 'DONE') return GK.verdictInfo(status.verdict).tone;
    if (status.phase === 'FAILED') return 'hold';
    return null;
  }

  // AWS path and chips and steps
  function render() {
    const states = GK.pipelineStates(view);
    for (const node of doc.querySelectorAll('[data-node]')) {
      const state = states[node.dataset.node] || 'idle';
      node.dataset.state = state;
      const label = node.querySelector('[data-node-state]');
      if (label) label.textContent = GK.nodeLabel(state);
    }
    ui.pipeline.dataset.mode = view.mode;
    // thin moving line while the job is not done yet
    // no fake percent
    const watching = view.mode === 'tracking' && view.phase !== 'DONE' && !view.paused;
    ui.activity.dataset.busy = String(view.mode === 'sending' || watching);
    // show the button only while this page is really asking
    ui.stopWatch.hidden = !(watching && tracking);
    ui.pipeCaption.textContent = GK.pipelineCaption(view);
    const chip = GK.phaseChip(view);
    setChip(ui.pipeChip, chip);
    setChip(ui.actChip, chip);
    const steps = GK.lifecycle(view);
    for (const step of doc.querySelectorAll('[data-step]')) step.dataset.state = steps[step.dataset.step] || 'todo';
    renderScanStat(chip);
  }

  // first time each step shows up
  // shown as time since the scan started
  // reopened scan from a link or Check again
  // we do not know the start time so no step time
  function stampSteps() {
    if (!tracking) return;
    const steps = GK.lifecycle(view);
    const elapsed = Date.now() - tracking.startedAt;
    for (const name of GK.STEPS) {
      if (steps[name] !== 'todo' && tracking.seen[name] === undefined) tracking.seen[name] = tracking.fromLink ? null : elapsed;
      const slot = doc.querySelector(`[data-step-time="${name}"]`);
      const at = tracking.seen[name];
      if (slot) slot.textContent = at === undefined || at === null ? '' : `+${GK.formatDuration(at)}`;
    }
  }

  function renderScanStat(chip) {
    if (view.mode === 'idle') {
      ui.statScan.textContent = '—';
      delete ui.statScan.dataset.tone;
      ui.statScanNote.textContent = 'No scan yet';
      return;
    }
    ui.statScan.textContent = chip.label;
    ui.statScan.dataset.tone = chip.tone;
    if (tracking) ui.statScanNote.textContent = GK.shortJobId(tracking.jobId);
    else if (view.mode === 'rejected' || view.mode === 'limited') ui.statScanNote.textContent = 'Nothing was queued';
    else if (lastJobId) ui.statScanNote.textContent = GK.shortJobId(lastJobId);
  }

  function showActivity(panel) {
    for (const each of [ui.empty, ui.live, ui.problem]) each.hidden = each !== panel;
  }

  function showProblem(message) {
    ui.problemText.textContent = message;
    showActivity(ui.problem);
    announce(message);
  }

  // the scanner form
  function updateEditor() {
    const value = ui.code.value;
    const bytes = GK.codeBytes(value);
    const lines = GK.lineCount(value);
    ui.size.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'} · ${GK.formatKB(bytes)} of 100 KB`;
    ui.size.classList.toggle('over', bytes > GK.MAX_CODE_BYTES);
    // nothing in the box so Clear is off
    ui.clearCode.disabled = value.length === 0;
    const count = Math.min(Math.max(lines, 1), 5000);
    if (count !== gutterCount) {
      gutterCount = count;
      const numbers = [];
      for (let n = 1; n <= count; n += 1) numbers.push(n);
      ui.gutter.textContent = numbers.join('\n');
    }
    ui.gutter.scrollTop = ui.code.scrollTop;
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
    if (body && typeof body.message === 'string') return body.message;
    return `GateKeeper answered with status ${code}. Scan again in a moment.`;
  }

  function loadSample(templateId, filename) {
    ui.code.value = `${byId(templateId).content.textContent.trim()}\n`;
    ui.filename.value = filename;
    updateEditor();
    clearFormError();
    ui.code.focus();
  }

  // clear button empties the box only
  // nothing goes to AWS
  function clearCode() {
    if (!ui.code.value) return;
    ui.code.value = '';
    ui.filename.value = 'snippet.js';
    updateEditor();
    clearFormError();
    ui.code.focus();
    announce('Code box cleared.');
  }

  // open a js file from my disk into the box
  // we read it here in the browser
  // nothing goes out until Run security scan
  async function openLocalFile() {
    const file = ui.fileInput.files && ui.fileInput.files[0];
    ui.fileInput.value = '';
    if (!file) return;
    const problem = GK.fileProblem(file.name, file.size);
    if (problem) {
      showFormError(problem, null);
      return;
    }
    try {
      const text = await file.text();
      if (GK.codeBytes(text) > GK.MAX_CODE_BYTES) {
        showFormError(GK.fileProblem(file.name, GK.codeBytes(text)), null);
        return;
      }
      ui.code.value = text;
      ui.filename.value = GK.safeFilename(file.name);
      updateEditor();
      clearFormError();
      // start at line 1 and do not jump the page
      ui.code.setSelectionRange(0, 0);
      ui.code.scrollTop = 0;
      ui.code.focus({ preventScroll: true });
      announce(`Opened ${ui.filename.value}. Nothing is sent until you scan.`);
    } catch (ignored) {
      showFormError('This file could not be read. Try another .js file.', null);
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (ui.scan.disabled) return undefined;
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
    hideAccess();

    stopTracking();
    resetLog();
    hideReport();
    showActivity(ui.live);
    resetLiveMeta();
    ui.statusText.textContent = 'Sending your code to API Gateway.';
    view = { mode: 'sending' };
    render();
    ui.scan.disabled = true;
    ui.scanLabel.textContent = 'Sending code';
    const sentAt = Date.now();
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
      const took = Date.now() - sentAt;
      if (response.status === 202 && body && GK.isJobId(body.jobId)) {
        addLog(`POST /scans → 202 · ${GK.shortJobId(body.jobId)}`, null, took);
        rememberJob(body.jobId);
        startTracking(body.jobId, { sentAt, traceId: body.traceId });
        return undefined;
      }
      addLog(`POST /scans → ${response.status}${body && typeof body.error === 'string' ? ` · ${body.error}` : ''}`, 'stop', took);
      view = { mode: response.status === 429 ? 'limited' : 'rejected' };
      render();
      ui.statusText.textContent = 'Nothing was queued.';
      return showFormError(submitMessage(response.status, body), response.status === 401 ? ui.access : null);
    } catch (networkProblem) {
      addLog('POST /scans → no answer (network)', 'stop');
      view = { mode: 'rejected' };
      render();
      ui.statusText.textContent = 'Nothing was queued.';
      return showFormError('GateKeeper could not be reached. Check your connection, then scan again.', null);
    } finally {
      ui.scan.disabled = false;
      ui.scanLabel.textContent = 'Run security scan';
    }
  }

  // show or hide the access code
  // it is never saved anywhere
  function hideAccess() {
    ui.access.type = 'password';
    ui.toggleAccess.setAttribute('aria-pressed', 'false');
    ui.toggleAccess.setAttribute('aria-label', 'Show access code');
  }

  function toggleAccess() {
    if (ui.access.type !== 'password') return hideAccess();
    ui.access.type = 'text';
    ui.toggleAccess.setAttribute('aria-pressed', 'true');
    ui.toggleAccess.setAttribute('aria-label', 'Hide access code');
    return undefined;
  }

  // following one scan
  function rememberJob(jobId) {
    const url = new URL(win.location.href);
    url.searchParams.set('job', jobId);
    win.history.replaceState(null, '', url);
    try {
      win.localStorage.setItem(LAST_JOB_KEY, jobId);
    } catch (ignored) {
      // storage can be off in private windows
      // the link still works
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

  function resetLiveMeta() {
    ui.jobId.textContent = '—';
    ui.traceId.textContent = '—';
    ui.tryText.textContent = '—';
    ui.statusClock.textContent = '0 s';
    ui.pollCount.textContent = '0 polls';
    ui.readPolls.textContent = '0 polls';
    ui.checkAgain.hidden = true;
    ui.viewReport.hidden = true;
    for (const slot of doc.querySelectorAll('[data-step-time]')) slot.textContent = '';
  }

  // the page stops asking but the job keeps running on AWS
  function pauseWatching(byUser) {
    // Stop watching goes away in render so check first if it had focus
    const hadFocus = doc.activeElement === ui.stopWatch;
    stopTracking();
    view = { ...view, paused: true };
    render();
    ui.statusText.textContent = 'This page stopped asking. The job may still run on AWS.';
    ui.checkAgain.hidden = false;
    // Stop watching is gone now so keep focus on Check again
    if (byUser || hadFocus) ui.checkAgain.focus();
    if (byUser) {
      addLog('Stopped watching · the job keeps running on AWS', 'hold');
      announce('Stopped watching. The job may still run on AWS.');
    }
  }

  function startTracking(jobId, { sentAt = null, traceId = null, fromLink = false, keepLog = false } = {}) {
    stopTracking();
    lastJobId = jobId;
    if (fromLink) {
      if (!keepLog) resetLog();
      hideReport();
    }
    resetLiveMeta();
    // lastCode stays null until a bad answer comes back
    // then it keeps the last bad http code
    // 0 means no answer at all for the 2 minute note
    tracking = { jobId, startedAt: sentAt || Date.now(), timer: 0, polls: 0, seen: {}, fromLink, lastKey: '', lastCode: null };
    ui.jobId.textContent = jobId;
    ui.jobId.title = jobId;
    ui.traceId.textContent = typeof traceId === 'string' && traceId ? traceId : '—';
    ui.statusText.textContent = fromLink ? 'Opening this scan.' : 'Code received. Waiting for the first update.';
    showActivity(ui.live);
    view = { mode: 'tracking', phase: fromLink ? null : 'QUEUED', attempt: 0 };
    render();
    stampSteps();
    poll(tracking);
  }

  async function poll(current) {
    if (tracking !== current) return;
    let status = null;
    let took = null;
    try {
      const { code, body, ms } = await getJson(`/scans/${encodeURIComponent(current.jobId)}`);
      if (tracking !== current) return;
      current.polls += 1;
      took = ms;
      if (code === 404) {
        addLog('GET /scans/{id} → 404 · no such job', 'hold', ms);
        stopTracking();
        view = { mode: 'lost' };
        render();
        showProblem('This link has no scan. Pasted code is kept for one day, so the scan may have expired.');
        return;
      }
      if (code === 200 && body) {
        status = body;
      } else {
        // keep the last bad answer for the 2 minute note
        current.lastCode = code;
        addLog(`GET /scans/{id} → ${GK.pollProblem(code, Boolean(body))}`, 'hold', ms);
      }
    } catch (ignored) {
      // short network drop
      // log it and try again next time
      // repeats get counted on one line
      if (tracking === current) {
        current.lastCode = 0;
        addLog('GET /scans/{id} → no answer (network)', 'hold');
      }
    }
    if (tracking !== current) return;

    const elapsed = Date.now() - current.startedAt;
    ui.statusClock.textContent = GK.formatDuration(elapsed);
    ui.pollCount.textContent = `${current.polls} ${current.polls === 1 ? 'poll' : 'polls'}`;
    ui.readPolls.textContent = ui.pollCount.textContent;
    if (status) {
      const key = `${status.phase}|${status.attempt}|${status.verdict}`;
      if (key !== current.lastKey) {
        current.lastKey = key;
        addLog(`GET /scans/{id} → ${GK.statusSummary(status)}`, toneOf(status), took);
      }
      ui.statusText.textContent = GK.statusLine(status);
      const attempt = Number(status.attempt) || 0;
      ui.tryText.textContent = attempt > 0 ? `${attempt} of ${Number(status.maxAttempts) || GK.MAX_ATTEMPTS}` : 'not started';
      // Stop watching goes away at DONE
      // remember if it had focus
      const stopHadFocus = doc.activeElement === ui.stopWatch;
      view = { mode: 'tracking', phase: status.phase, attempt, verdict: status.verdict, reportReady: false, hasReport: Boolean(status.hasReport) };
      render();
      stampSteps();
      if (status.phase === 'DONE') {
        stopTracking();
        await showResult(status, current);
        if (stopHadFocus && !ui.viewReport.hidden) ui.viewReport.focus();
        return;
      }
    }
    if (!GK.shouldKeepPolling(elapsed, status ? status.phase : 'QUEUED')) {
      pauseWatching(false);
      // say what really came back like a status or an error code or nothing
      const note = GK.stopNote(Boolean(current.lastKey), current.lastCode);
      ui.statusText.textContent = note.text;
      announce(note.say);
      return;
    }
    current.timer = win.setTimeout(() => poll(current), GK.pollDelayMs(elapsed));
  }

  async function showResult(status, current) {
    let report = null;
    if (status.hasReport) {
      try {
        const { code, body, ms } = await getJson(`/scans/${encodeURIComponent(status.jobId)}/report`);
        if (code === 200 && body) {
          report = body;
          const n = Array.isArray(body.findings) ? body.findings.length : 0;
          addLog(`GET /scans/{id}/report → 200 · ${n} ${n === 1 ? 'finding' : 'findings'}, masked`, null, ms);
        } else {
          addLog(`GET /scans/{id}/report → ${code}`, 'hold', ms);
        }
      } catch (ignored) {
        addLog('GET /scans/{id}/report → no answer', 'hold');
      }
    }
    view = { ...view, reportReady: true, hasReport: Boolean(report) };
    tracking = current;
    render();
    stampSteps();
    tracking = null;
    renderTime(status);
    renderReport(status, report);
    ui.viewReport.hidden = false;
    if (report) ui.statusText.textContent = 'Scan finished. The report is ready below.';
    else if (status.verdict === 'INCOMPLETE') ui.statusText.textContent = 'Scan finished as INCOMPLETE. No report was saved.';
    else ui.statusText.textContent = 'Scan finished. The full report could not be loaded.';
    loadRecent();
  }

  function renderTime(status) {
    const ms = GK.jobDurationMs(status);
    ui.statTime.textContent = ms === null ? '—' : GK.formatDuration(ms);
    ui.statTimeNote.textContent = ms === null ? 'No timing for this scan' : 'Server time from DynamoDB';
  }

  // the security report
  function hideReport() {
    ui.reportEmpty.hidden = false;
    ui.reportBody.hidden = true;
    ui.reportSub.textContent = DEFAULT_REPORT_SUB;
    ui.statFindings.textContent = '—';
    delete ui.statFindings.dataset.tone;
    ui.statFindingsNote.textContent = 'Shown when a scan ends';
    ui.statTime.textContent = '—';
    ui.statTimeNote.textContent = 'From the job record';
    findings = [];
    reportCounts = null;
    lastVerdict = null;
  }

  function renderReport(status, report) {
    const info = GK.verdictInfo(status.verdict);
    ui.reportEmpty.hidden = true;
    ui.reportBody.hidden = false;
    ui.verdict.dataset.tone = info.tone;
    ui.verdictMark.textContent = info.label;
    ui.verdictTitle.textContent = info.title;
    ui.verdictText.textContent = info.summary;
    ui.verdictGate.textContent = info.gate;
    ui.verdict.classList.remove('land');
    win.requestAnimationFrame(() => ui.verdict.classList.add('land'));

    hasReport = Boolean(report);
    lastVerdict = status.verdict || null;
    // full or partial or none
    // partial means INCOMPLETE with some files
    // none means nothing to count
    const countState = GK.countsState(status, hasReport);
    const scanned = countState !== 'none';
    const counts = status.counts || (hasReport ? GK.countBySeverity(report.findings) : { high: 0, medium: 0, low: 0 });
    reportCounts = scanned ? counts : null;
    renderCounts(counts, countState);
    renderSubject(status, report);
    ui.reportSub.textContent = status.source === 'pr'
      ? `Pull request #${status.prNumber} · commit ${GK.shortSha(status.headSha)}`
      : `Paste scan · ${status.filename || 'snippet.js'}`;

    findings = hasReport && Array.isArray(report.findings) ? GK.sortFindings(report.findings) : [];
    filter = 'all';
    renderFindings();

    const skipped = hasReport && Array.isArray(report.skippedFiles) ? report.skippedFiles : [];
    ui.skippedList.replaceChildren(...skipped.map((file) => el('li', null, `${file.path}: ${String(file.reason || '').replace(/_/g, ' ')}`)));
    ui.skipped.hidden = skipped.length === 0;

    ui.scanFacts.replaceChildren(...GK.scanFacts(status).flatMap(([label, value]) => [el('dt', null, label), el('dd', null, value)]));
    ui.scanLog.open = GK.scanLogOpen(status);
    scrollReportLog();

    ui.shareLink.value = `${win.location.origin}${win.location.pathname}?job=${status.jobId}`;
    setButtonText(ui.copyLink, 'Copy link');

    const total = (Number(counts.high) || 0) + (Number(counts.medium) || 0) + (Number(counts.low) || 0);
    if (scanned) {
      ui.statFindings.textContent = `${total} ${total === 1 ? 'finding' : 'findings'}`;
      ui.statFindings.dataset.tone = GK.findingsTone(status.verdict, counts);
      ui.statFindingsNote.textContent = GK.countsLine(counts);
    } else {
      ui.statFindings.textContent = '—';
      ui.statFindings.dataset.tone = 'hold';
      ui.statFindingsNote.textContent = 'Not scanned, so no counts';
    }
    announce(scanned ? `Scan finished: ${info.label}, ${GK.countsLine(counts)}.` : `Scan finished: ${info.label}, not scanned.`);
  }

  function renderCounts(counts, countState) {
    const scanned = countState !== 'none';
    const values = { high: Number(counts.high) || 0, medium: Number(counts.medium) || 0, low: Number(counts.low) || 0 };
    // not scanned shows a dash and never 0
    // 0 high could look like a pass
    ui.countHigh.textContent = scanned ? values.high : '—';
    ui.countMedium.textContent = scanned ? values.medium : '—';
    ui.countLow.textContent = scanned ? values.low : '—';
    ui.sevList.dataset.state = countState;
    for (const [node, text] of SEV_NOTES) node.textContent = scanned ? text : 'not checked';
    for (const row of doc.querySelectorAll('[data-sev]')) row.classList.toggle('has', scanned && values[row.dataset.sev] > 0);

    for (const old of ui.donut.querySelectorAll('.seg')) old.remove();
    const { total, parts } = GK.donutParts(scanned ? values : { high: 0, medium: 0, low: 0 }, DONUT_C);
    for (const part of parts) {
      const circle = doc.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('class', `seg seg-${part.key}`);
      circle.setAttribute('cx', '60');
      circle.setAttribute('cy', '60');
      circle.setAttribute('r', String(DONUT_R));
      circle.setAttribute('stroke-dasharray', part.dash);
      circle.setAttribute('stroke-dashoffset', String(part.offset));
      ui.donut.append(circle);
    }
    ui.donutTotal.textContent = scanned ? total : '—';
    if (!scanned) ui.donutLabel.textContent = 'not scanned';
    else if (countState === 'partial') ui.donutLabel.textContent = 'in scanned files';
    else ui.donutLabel.textContent = total === 1 ? 'finding' : 'findings';
  }

  function subjectRow(key, value) {
    const row = el('div', 'subject-row');
    const val = el('p', 'subject-val');
    if (typeof value === 'string') val.textContent = value;
    else val.append(value);
    row.append(el('span', 'subject-key', key), val);
    return row;
  }

  function renderSubject(status, report) {
    const rows = [];
    if (status.source === 'pr' && GK.isRepoName(status.repo) && Number.isInteger(status.prNumber)) {
      const link = el('a', null, `${status.repo} #${status.prNumber}`);
      link.href = `https://github.com/${status.repo}/pull/${status.prNumber}`;
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      rows.push(subjectRow('Pull request', link));
      rows.push(subjectRow('Commit', el('code', null, GK.shortSha(status.headSha))));
    } else {
      rows.push(subjectRow('File', el('code', null, status.filename || 'snippet.js')));
    }
    const when = report && report.scannedAt ? report.scannedAt : status.updatedAt;
    if (when) rows.push(subjectRow('Scanned', GK.timeAgo(when, Date.now())));
    if (report && typeof report.scannerVersion === 'string') rows.push(subjectRow('Scanner', report.scannerVersion));
    const id = el('code', null, GK.shortJobId(status.jobId));
    id.title = status.jobId;
    rows.push(subjectRow('Job ID', id));
    ui.subject.replaceChildren(...rows);
  }

  function filterLabel(key) {
    return key === 'all' ? 'All' : GK.severityLabel(key);
  }

  function renderFindings() {
    const tally = { all: findings.length, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const f of findings) if (f.severity in tally) tally[f.severity] += 1;
    for (const button of ui.filters.querySelectorAll('[data-filter]')) {
      const key = button.dataset.filter;
      button.textContent = `${filterLabel(key)} ${tally[key] || 0}`;
      button.setAttribute('aria-pressed', String(key === filter));
      button.disabled = !hasReport;
    }
    // chips only help when there is something to filter
    ui.filters.hidden = findings.length === 0;
    ui.findingsTitle.textContent = hasReport ? `${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}` : 'Findings';

    const shown = filter === 'all' ? findings : findings.filter((f) => f.severity === filter);
    ui.findings.replaceChildren(...shown.map(findingItem));
    if (!hasReport && lastVerdict === 'INCOMPLETE') ui.findingsEmpty.textContent = 'No report was saved for this scan. Scan the code again to get one.';
    else if (!hasReport) ui.findingsEmpty.textContent = 'The full report could not be loaded. It may have expired (pasted code is kept 1 day).';
    else if (findings.length === 0) ui.findingsEmpty.textContent = GK.noFindingsText(lastVerdict);
    else if (shown.length === 0) ui.findingsEmpty.textContent = `No ${filterLabel(filter).toLowerCase()} findings in this scan.`;
    ui.findingsEmpty.hidden = shown.length > 0;
    const cap = hasReport ? GK.cappedNote(findings.length, reportCounts) : '';
    ui.findingsCap.textContent = cap;
    ui.findingsCap.hidden = !cap;
  }

  // one finding is one card you can open and close
  // HIGH starts open
  function findingItem(f) {
    const tone = GK.severityTone(f.severity);
    const item = el('li', `finding sev-${tone}`);
    const box = el('details', 'finding-box');
    box.open = tone === 'high';
    const head = el('summary', 'finding-head');
    head.append(el('span', 'sev', GK.severityLabel(f.severity)), el('span', 'finding-name', f.name || f.id || 'Finding'));
    if (f.id) head.append(el('span', 'rule', f.id));
    const chev = icon('chevron');
    chev.classList.add('chev');
    head.append(el('span', 'where', `${f.file || 'file'}:${f.line || '?'}`), chev);
    box.append(head);
    const body = el('div', 'finding-body');
    if (f.description) body.append(el('p', 'finding-what', f.description));
    if (f.evidence) {
      const pre = el('pre', 'evidence');
      pre.append(el('code', null, f.evidence));
      body.append(pre);
    }
    if (f.message) {
      const fix = el('p', 'finding-fix');
      fix.append(icon('check'), el('span', null, `How to fix: ${f.message}`));
      body.append(fix);
    }
    box.append(body);
    item.append(box);
    return item;
  }

  // recent pull request checks
  function cell(label, content, className) {
    const td = el('td', className || null);
    td.dataset.label = label;
    if (typeof content === 'string') td.textContent = content;
    else if (content) td.append(content);
    return td;
  }

  function resultChip(item) {
    if (item.phase === 'DONE' && item.verdict) {
      const info = GK.verdictInfo(item.verdict);
      const chip = el('span', 'chip', info.label);
      chip.dataset.tone = info.tone;
      return chip;
    }
    const chip = el('span', 'chip', item.phase === 'FAILED' ? 'RETRYING' : 'SCANNING');
    chip.dataset.tone = item.phase === 'FAILED' ? 'hold' : 'run';
    return chip;
  }

  function countPills(counts) {
    if (!counts) return el('span', 'mono', 'not yet');
    const wrap = el('span', 'counts');
    for (const [key, letter] of [['high', 'h'], ['medium', 'm'], ['low', 'l']]) {
      const n = Number(counts[key]) || 0;
      const pill = el('span', `count-pill ${letter}${n > 0 ? ' has' : ''}`, `${n} ${letter.toUpperCase()}`);
      pill.title = `${n} ${key}`;
      wrap.append(pill);
    }
    return wrap;
  }

  function prCell(item) {
    const wrap = el('span', 'pr-cell');
    wrap.append(icon('pr'), doc.createTextNode(`#${item.prNumber}`));
    return wrap;
  }

  function openLink(jobId) {
    if (!GK.isJobId(jobId)) return null;
    const link = el('a', 'open-link', 'Open');
    link.href = `?job=${jobId}`;
    link.append(icon('arrow'));
    return link;
  }

  function renderRecent(items) {
    ui.recentBody.replaceChildren();
    renderPrStat(items[0] || null, false);
    if (items.length === 0) {
      ui.recentTable.hidden = true;
      ui.recentNote.textContent = 'No pull request checks yet. Open a pull request in the demo repository to see one here.';
      ui.recentNote.hidden = false;
      return;
    }
    const now = Date.now();
    for (const item of items) {
      const row = el('tr');
      row.append(
        cell('Pull request', prCell(item)),
        cell('Commit', GK.shortSha(item.headSha), 'mono'),
        cell('Result', resultChip(item)),
        cell('Findings', countPills(item.counts)),
        cell('When', GK.timeAgo(item.createdAt, now)),
        cell('Report', openLink(item.jobId)),
      );
      ui.recentBody.append(row);
    }
    ui.recentTable.hidden = false;
    ui.recentNote.textContent = `Showing the newest ${items.length} of up to 20.`;
    ui.recentNote.hidden = false;
  }

  function renderPrStat(item, broken) {
    if (!item) {
      ui.statPr.textContent = '—';
      delete ui.statPr.dataset.tone;
      ui.statPrNote.textContent = broken ? 'List not available' : 'No PR scans yet';
      return;
    }
    const chip = item.phase === 'DONE' && item.verdict ? GK.verdictInfo(item.verdict) : { label: 'scanning', tone: 'run' };
    ui.statPr.textContent = `#${item.prNumber} ${chip.label}`;
    ui.statPr.dataset.tone = chip.tone;
    ui.statPrNote.textContent = `${GK.shortSha(item.headSha)} · ${GK.timeAgo(item.createdAt, Date.now())}`;
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
      renderPrStat(null, true);
    }
  }

  // page frame with the env pill and nav and reveal
  function renderEnv() {
    const env = GK.envLabel(win.location.hostname);
    ui.envText.textContent = env.text;
    ui.envPill.dataset.tone = env.tone;
    // test markers only work in the local fake worker and never on AWS
    ui.localTests.hidden = !GK.isLocalHost(win.location.hostname);
  }

  function watchSections() {
    if (!('IntersectionObserver' in win)) return;
    const links = new Map([...doc.querySelectorAll('[data-nav]')].map((a) => [a.dataset.nav, a]));
    const spy = new win.IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const a of links.values()) a.removeAttribute('aria-current');
        const link = links.get(entry.target.id);
        if (link) link.setAttribute('aria-current', 'true');
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    for (const id of links.keys()) {
      const section = doc.getElementById(id);
      if (section) spy.observe(section);
    }
  }

  function revealCards() {
    const items = [...doc.querySelectorAll('.reveal')];
    if (!('IntersectionObserver' in win)) {
      for (const item of items) item.classList.add('is-in');
      return;
    }
    const seen = new win.IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          seen.unobserve(entry.target);
        }
      }
    }, { rootMargin: '0px 0px -6% 0px' });
    for (const item of items) seen.observe(item);
  }

  // start
  doc.documentElement.classList.add('js');
  const isMac = /Mac|iPhone|iPad/.test(win.navigator.platform || '');
  ui.kbd.textContent = isMac ? '⌘ ↵' : 'Ctrl ↵';
  ui.form.addEventListener('submit', onSubmit);
  // hero button jumps to the editor then puts the cursor in it
  ui.ctaScan.addEventListener('click', () => {
    win.setTimeout(() => ui.code.focus({ preventScroll: true }), 420);
  });
  ui.code.addEventListener('input', updateEditor);
  ui.code.addEventListener('scroll', () => {
    ui.gutter.scrollTop = ui.code.scrollTop;
  });
  doc.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && ui.form.contains(doc.activeElement)) {
      event.preventDefault();
      ui.form.requestSubmit();
    }
  });
  ui.toggleAccess.addEventListener('click', toggleAccess);
  ui.loadRisky.addEventListener('click', () => loadSample('sample-risky', 'demo-risk.js'));
  ui.loadClean.addEventListener('click', () => loadSample('sample-clean', 'demo-clean.js'));
  ui.loadRetry.addEventListener('click', () => loadSample('sample-retry', 'demo-retry.js'));
  ui.loadIncomplete.addEventListener('click', () => loadSample('sample-incomplete', 'demo-incomplete.js'));
  ui.loadSlow.addEventListener('click', () => loadSample('sample-slow', 'demo-slow.js'));
  ui.openFile.addEventListener('click', () => ui.fileInput.click());
  ui.clearCode.addEventListener('click', clearCode);
  ui.fileInput.addEventListener('change', openLocalFile);
  ui.checkAgain.addEventListener('click', () => {
    if (!lastJobId) return;
    // the status answer has no trace id so keep the one shown
    const shown = ui.traceId.textContent;
    const traceId = shown && shown !== '—' ? shown : null;
    startTracking(lastJobId, { fromLink: true, keepLog: true, traceId });
    announce('Watching this scan again.');
    // the pressed button is gone now so move focus to Stop watching
    if (!ui.stopWatch.hidden) ui.stopWatch.focus();
  });
  ui.stopWatch.addEventListener('click', () => pauseWatching(true));
  ui.scanLog.addEventListener('toggle', () => {
    if (ui.scanLog.open) scrollReportLog();
  });
  ui.copyJob.addEventListener('click', () => {
    if (!lastJobId) return;
    copyText(lastJobId, (ok) => {
      ui.copyJob.setAttribute('aria-label', ok ? 'Copied' : 'Copy failed');
      win.setTimeout(() => ui.copyJob.setAttribute('aria-label', 'Copy job ID'), 1600);
      announce(ok ? 'Job ID copied.' : 'Copy failed. Select the ID and press Ctrl+C.');
    });
  });
  ui.copyLink.addEventListener('click', () => {
    copyText(ui.shareLink.value, (ok) => {
      if (!ok) ui.shareLink.select();
      setButtonText(ui.copyLink, ok ? 'Copied' : 'Press Ctrl+C');
    });
  });
  ui.filters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button || button.disabled) return;
    filter = button.dataset.filter;
    renderFindings();
  });
  ui.refreshRecent.addEventListener('click', loadRecent);

  updateEditor();
  renderEnv();
  render();
  revealCards();
  watchSections();

  const fromLink = new URLSearchParams(win.location.search).get('job');
  if (GK.isJobId(fromLink)) {
    startTracking(fromLink, { fromLink: true });
  } else {
    const previous = readLastJob();
    if (previous) {
      ui.lastScan.hidden = false;
      ui.lastScan.addEventListener('click', () => {
        rememberJob(previous);
        startTracking(previous, { fromLink: true });
      });
    }
  }
  loadRecent();
})(globalThis.GK, document, window);
