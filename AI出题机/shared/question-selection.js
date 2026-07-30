function normalizeQuestionCount(totalQuestions) {
  const total = Number.parseInt(totalQuestions, 10);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

function areAllQuestionsSelected(selectedQuestions, totalQuestions) {
  const total = normalizeQuestionCount(totalQuestions);
  if (!(selectedQuestions instanceof Set) || total === 0 || selectedQuestions.size !== total) {
    return false;
  }
  for (let index = 0; index < total; index += 1) {
    if (!selectedQuestions.has(index)) return false;
  }
  return true;
}

function setAllQuestionsSelected(selectedQuestions, totalQuestions, shouldSelect) {
  if (!(selectedQuestions instanceof Set)) {
    throw new TypeError('selectedQuestions 必须是 Set');
  }
  const total = normalizeQuestionCount(totalQuestions);
  selectedQuestions.clear();
  if (shouldSelect) {
    for (let index = 0; index < total; index += 1) selectedQuestions.add(index);
  }
  return selectedQuestions;
}

module.exports = {
  areAllQuestionsSelected,
  setAllQuestionsSelected
};
