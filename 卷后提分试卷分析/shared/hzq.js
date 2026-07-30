(() => {
  const ANALYSIS_COST = 1;

  async function checkCredit() {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.user) {
        window.location.assign(`http://${window.location.hostname}:4173/?login=1`);
        return false;
      }
      if (Number(payload.user.points) < ANALYSIS_COST) {
        window.alert('积分不足，请先返回艾爸AI学习主站兑换积分。');
        return false;
      }
      return true;
    } catch {
      window.alert('暂时无法读取账号积分，请稍后重试。');
      return false;
    }
  }

  window.HZQ = Object.freeze({ checkCredit });
})();
