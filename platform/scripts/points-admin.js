import {
  createAdminSession,
  escapeHtml,
  formatTime,
  renderTable,
  requestJson,
  setAdminStatus,
  showAdminToast,
} from './admin-common.js';

const refreshButton = document.querySelector('#refreshPointsButton');
const summary = document.querySelector('#pointsSummary');
const createCodesForm = document.querySelector('#createCodesForm');
const codePointsInput = document.querySelector('#codePointsInput');
const codeCountInput = document.querySelector('#codeCountInput');
const createCodesButton = document.querySelector('#createCodesButton');
const codesOutput = document.querySelector('#createdCodesOutput');
const adjustForm = document.querySelector('#adjustPointsForm');
const adjustUsername = document.querySelector('#adjustUsernameInput');
const adjustMode = document.querySelector('#adjustModeInput');
const adjustPoints = document.querySelector('#adjustPointsInput');
const adjustNote = document.querySelector('#adjustNoteInput');
const adjustButton = document.querySelector('#adjustPointsButton');

refreshButton.addEventListener('click', loadOverview);
createCodesForm.addEventListener('submit', createCodes);
adjustForm.addEventListener('submit', adjustUserPoints);

createAdminSession({
  onAuthorized: loadOverview,
  onUnauthorized: clearOverview,
});

async function loadOverview() {
  refreshButton.disabled = true;
  setAdminStatus('正在读取积分数据');
  try {
    const data = await requestJson('/api/admin/points/overview');
    renderOverview(data);
    setAdminStatus('积分数据已更新', 'success');
  } catch (error) {
    setAdminStatus(error.message || '积分数据读取失败', 'error');
  } finally {
    refreshButton.disabled = false;
  }
}

function renderOverview(data) {
  summary.innerHTML = [
    ['用户数', data.summary?.userCount ?? 0],
    ['用户总积分', data.summary?.totalPoints ?? 0],
    ['成功出图', data.summary?.successfulImages ?? 0],
    ['已退积分', data.summary?.refundedPoints ?? 0],
  ].map(([label, value]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong></article>`).join('');

  renderTable(document.querySelector('#usersTable'), ['账号', '角色', '积分', '创建时间', '更新时间'], (data.users || []).map((user) => [
    user.username,
    user.role === 'admin' ? '管理员' : '用户',
    user.points,
    formatTime(user.createdAt),
    formatTime(user.updatedAt),
  ]));
  renderTable(document.querySelector('#batchesTable'), ['账号', '状态', '预扣', '成功', '退款'], (data.batches || []).map((batch) => [
    batch.username,
    batch.status,
    batch.reservedPoints,
    batch.successCount,
    batch.refundedPoints,
  ]));
  renderTable(document.querySelector('#pointLogsTable'), ['账号', '类型', '积分变化', '余额', '备注'], (data.logs || []).map((log) => [
    log.username,
    formatPointType(log.type),
    log.points > 0 ? `+${log.points}` : log.points,
    log.balanceAfter,
    log.note || '-',
  ]));
  renderTable(document.querySelector('#redeemCodesTable'), ['兑换码', '积分', '状态', '使用账号', '创建时间'], (data.redeemCodes || []).map((code) => [
    code.code,
    code.points,
    formatCodeStatus(code.status),
    code.usedByUsername || '-',
    formatTime(code.createdAt),
  ]));
}

async function createCodes(event) {
  event.preventDefault();
  createCodesButton.disabled = true;
  try {
    const data = await requestJson('/api/admin/points/redeem-codes', {
      method: 'POST',
      body: { points: Number(codePointsInput.value), count: Number(codeCountInput.value) },
    });
    const codes = data.codes || [];
    codesOutput.innerHTML = `<div class="code-output-head"><strong>已生成 ${codes.length} 个兑换码</strong><button class="mini-button" id="copyCodesButton" type="button">复制全部</button></div><div class="code-list">${codes.map((item) => `<code>${escapeHtml(item.code)} · ${item.points} 积分</code>`).join('')}</div>`;
    document.querySelector('#copyCodesButton').addEventListener('click', () => copyCodes(codes));
    showAdminToast(`已生成 ${codes.length} 个兑换码`);
    await loadOverview();
  } catch (error) {
    setAdminStatus(error.message || '兑换码生成失败', 'error');
  } finally {
    createCodesButton.disabled = false;
  }
}

async function copyCodes(codes) {
  const text = codes.map((item) => `${item.code}\t${item.points}积分`).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    showAdminToast('兑换码已复制');
  } catch {
    showAdminToast('浏览器未允许复制，请手动选择兑换码');
  }
}

async function adjustUserPoints(event) {
  event.preventDefault();
  adjustButton.disabled = true;
  try {
    const data = await requestJson('/api/admin/points/adjust', {
      method: 'POST',
      body: {
        username: adjustUsername.value.trim(),
        mode: adjustMode.value,
        points: Number(adjustPoints.value),
        note: adjustNote.value.trim(),
      },
    });
    showAdminToast(`${data.user.username} 当前积分：${data.user.points}`);
    await loadOverview();
  } catch (error) {
    setAdminStatus(error.message || '积分调整失败', 'error');
  } finally {
    adjustButton.disabled = false;
  }
}

function clearOverview() {
  summary.innerHTML = '';
  ['usersTable', 'batchesTable', 'pointLogsTable', 'redeemCodesTable'].forEach((id) => {
    document.querySelector(`#${id}`).innerHTML = '';
  });
}

function formatPointType(type) {
  return ({ admin_adjust: '管理员调整', redeem: '兑换', generation_reserve: '生成预扣', generation_refund: '生成退款' })[type] || type || '-';
}

function formatCodeStatus(status) {
  return status === 'used' ? '已使用' : '未使用';
}
