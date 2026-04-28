// ====================================================
// 兒童閱讀管理系統 - Google Apps Script API
// 貼到 Google Sheets 的「擴充功能 → Apps Script」
// ====================================================

const SS_ID = '1eM_i2mf0aIW4oMG_sL2Hi9Z0NqG3bc6wAhE5RCoUhOQ';

const BOOK_COLS = ['id','出版社','書名','已閱','購買日','買入價','購買平台','售出價','售出日','閱讀日','備註','再刷','語言'];
const TREASURE_COLS = ['id','日期','類型','鑽石','貝殼','備註','狀態'];
const BOOK_MAP = {
  'id':'id','出版社':'publisher','書名':'title','已閱':'read',
  '購買日':'purchaseDate','買入價':'price','購買平台':'platform',
  '售出價':'soldPrice','售出日':'soldDate','閱讀日':'readDate',
  '備註':'note','再刷':'reprint','語言':'lang'
};

function rewardHeaders() {
  const h = ['月份','任務名稱','積分'];
  for (let i = 1; i <= 31; i++) h.push(String(i));
  return h;
}

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.openById(SS_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers) sheet.appendRow(headers);
  }
  return sheet;
}

function fmtDate(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return val ? String(val) : '';
}

// Normalize month cell value: Date → "yyyy-MM", String → trimmed
function normMonth(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM');
  }
  return val ? String(val).trim() : '';
}

// ===== HTTP Handlers =====

function doGet(e) {
  try {
    return json({
      books: readBooks(),
      rewards: readRewardSheet('獎勵'),
      pending: readRewardSheet('待確認'),
      settings: readSettings(),
      treasure: readTreasure()
    });
  } catch(err) {
    return json({ error: err.toString() });
  }
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    let r;
    switch(d.action) {
      case 'saveBook':      r = saveBook(d.book); break;
      case 'deleteBook':    r = deleteBookById(d.id); break;
      case 'updateReward':  r = updateRewardCell(d.month, d.taskName, d.points, d.day, d.count, d.sheetName || '獎勵'); break;
      case 'approveTask':   r = doApproveTask(d.month, d.taskName, d.day); break;
      case 'rejectTask':    r = doRejectTask(d.month, d.taskName, d.day); break;
      case 'ensureMonth':   r = ensureMonth(d.month, d.tasks); break;
      case 'syncMonthTasks': r = syncMonthTasks(d.month, d.tasks); break;
      case 'updateTaskDef': r = updateTaskDef(d.month, d.oldName, d.newName, d.points); break;
      case 'deleteTaskDef': r = deleteTaskDef(d.month, d.taskName); break;
      case 'saveSetting':   r = saveSetting(d.key, d.value); break;
      case 'clearAll':      r = clearAll(); break;
      case 'clearRewards':  r = clearRewardsOnly(); break;
      case 'addTreasure':   r = addTreasure(d.date, d.type, d.diamonds, d.shells, d.note, d.status); break;
      case 'approveTreasure': r = approveTreasureById(d.id); break;
      case 'rejectTreasure':  r = rejectTreasureById(d.id); break;
      default: r = { error: 'Unknown action: ' + d.action };
    }
    return json(r);
  } catch(err) {
    return json({ error: err.toString() });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== READ =====

function readBooks() {
  const sheet = getOrCreateSheet('書單', BOOK_COLS);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  return data.slice(1).map(row => {
    const book = {};
    BOOK_COLS.forEach((col, i) => {
      const key = BOOK_MAP[col] || col;
      let val = row[i];
      if (col === '購買日' || col === '售出日') val = fmtDate(val);
      if (col === '閱讀日') {
        if (val instanceof Date) {
          val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        } else {
          val = val ? String(val) : '';
        }
      }
      book[key] = val;
    });
    book.id = Number(book.id) || 0;
    book.price = Number(book.price) || 0;
    book.soldPrice = book.soldPrice ? -Math.abs(Number(book.soldPrice)) : null;
    book.cost = Math.floor(book.price - (book.soldPrice ? Math.abs(book.soldPrice) : 0));
    book.bookCount = 1;
    book.readCount = book.readDate ? book.readDate.split(',').filter(function(d){return d.trim();}).length : (book.read === 'V' ? 1 : 0);
    return book;
  });
}

function readRewardSheet(sheetName) {
  const sheet = getOrCreateSheet(sheetName, rewardHeaders());
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return {};

  const result = {};
  for (let r = 1; r < data.length; r++) {
    const month = normMonth(data[r][0]);
    const taskName = String(data[r][1]).trim();
    const points = Number(data[r][2]) || 0;
    if (!month || !taskName) continue;

    if (!result[month]) result[month] = { tasks: [], total: 0 };

    const daily = {};
    for (let d = 3; d < 34; d++) {
      const dayNum = d - 2;
      const val = data[r][d];
      if (val && Number(val) > 0) daily[dayNum] = Number(val);
    }
    result[month].tasks.push({ name: taskName, points: points, daily: daily });
  }

  for (const m in result) {
    let total = 0;
    result[m].tasks.forEach(function(t) {
      Object.values(t.daily).forEach(function(c) { total += c * t.points; });
    });
    result[m].total = total;
  }
  return result;
}

function readSettings() {
  const sheet = getOrCreateSheet('設定', ['key','value']);
  const data = sheet.getDataRange().getValues();
  const s = {};
  for (let r = 1; r < data.length; r++) {
    if (data[r][0]) s[data[r][0]] = data[r][1];
  }
  return s;
}

// ===== WRITE: Books =====

function saveBook(book) {
  const sheet = getOrCreateSheet('書單', BOOK_COLS);
  const data = sheet.getDataRange().getValues();

  const row = BOOK_COLS.map(function(col) {
    const key = BOOK_MAP[col];
    let val = book[key];
    if (col === '售出價') val = val ? Math.abs(Number(val)) : '';
    return (val !== undefined && val !== null) ? val : '';
  });

  if (book.id) {
    for (let r = 1; r < data.length; r++) {
      if (Number(data[r][0]) === Number(book.id)) {
        sheet.getRange(r + 1, 1, 1, BOOK_COLS.length).setValues([row]);
        return { ok: true, id: book.id };
      }
    }
  }

  let maxId = 0;
  for (let r = 1; r < data.length; r++) {
    maxId = Math.max(maxId, Number(data[r][0]) || 0);
  }
  row[0] = maxId + 1;
  sheet.appendRow(row);
  return { ok: true, id: row[0] };
}

function deleteBookById(id) {
  const sheet = getOrCreateSheet('書單', BOOK_COLS);
  const data = sheet.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (Number(data[r][0]) === Number(id)) {
      sheet.deleteRow(r + 1);
      return { ok: true };
    }
  }
  return { error: 'Not found' };
}

// ===== WRITE: Rewards =====

function updateRewardCell(month, taskName, points, day, count, sheetName) {
  const sheet = getOrCreateSheet(sheetName, rewardHeaders());
  const data = sheet.getDataRange().getValues();

  for (let r = 1; r < data.length; r++) {
    if (normMonth(data[r][0]) === month && String(data[r][1]).trim() === taskName) {
      sheet.getRange(r + 1, Number(day) + 3).setValue(count > 0 ? count : '');
      return { ok: true };
    }
  }

  // Row not found → create
  const row = [month, taskName, points];
  for (let i = 1; i <= 31; i++) {
    row.push(i === Number(day) && count > 0 ? count : '');
  }
  sheet.appendRow(row);
  return { ok: true, created: true };
}

function doApproveTask(month, taskName, day) {
  const pSheet = getOrCreateSheet('待確認', rewardHeaders());
  const pData = pSheet.getDataRange().getValues();

  let pendingCount = 0, pendingRow = -1, points = 0;
  for (let r = 1; r < pData.length; r++) {
    if (normMonth(pData[r][0]) === month && String(pData[r][1]).trim() === taskName) {
      pendingRow = r;
      points = Number(pData[r][2]);
      pendingCount = Number(pData[r][Number(day) + 2]) || 0;
      break;
    }
  }
  if (pendingCount <= 0) return { ok: true, count: 0 };

  // Add to confirmed
  const cSheet = getOrCreateSheet('獎勵', rewardHeaders());
  const cData = cSheet.getDataRange().getValues();
  for (let r = 1; r < cData.length; r++) {
    if (normMonth(cData[r][0]) === month && String(cData[r][1]).trim() === taskName) {
      const cur = Number(cData[r][Number(day) + 2]) || 0;
      cSheet.getRange(r + 1, Number(day) + 3).setValue(cur + pendingCount);
      break;
    }
  }

  // Clear pending
  pSheet.getRange(pendingRow + 1, Number(day) + 3).setValue('');
  return { ok: true, count: pendingCount, points: pendingCount * points };
}

function doRejectTask(month, taskName, day) {
  const sheet = getOrCreateSheet('待確認', rewardHeaders());
  const data = sheet.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (normMonth(data[r][0]) === month && String(data[r][1]).trim() === taskName) {
      sheet.getRange(r + 1, Number(day) + 3).setValue('');
      return { ok: true };
    }
  }
  return { ok: true };
}

function ensureMonth(month, tasks) {
  ['獎勵','待確認'].forEach(function(sheetName) {
    const sheet = getOrCreateSheet(sheetName, rewardHeaders());
    const data = sheet.getDataRange().getValues();

    const existing = {};
    for (let r = 1; r < data.length; r++) {
      if (normMonth(data[r][0]) === month) {
        existing[String(data[r][1]).trim()] = true;
      }
    }

    tasks.forEach(function(t) {
      if (!existing[t.name]) {
        const row = [month, t.name, t.points];
        for (let i = 0; i < 31; i++) row.push('');
        sheet.appendRow(row);
      }
    });
  });
  return { ok: true };
}

// ===== SYNC: Reconcile month tasks (delete extra, add missing, update points) =====

function syncMonthTasks(month, tasks) {
  var taskMap = {};
  tasks.forEach(function(t) { taskMap[t.name] = t.points; });

  ['獎勵','待確認'].forEach(function(sheetName) {
    var sheet = getOrCreateSheet(sheetName, rewardHeaders());
    var data = sheet.getDataRange().getValues();

    // Pass 1: delete rows not in task list (reverse order to keep indices stable)
    for (var r = data.length - 1; r >= 1; r--) {
      if (normMonth(data[r][0]) === month) {
        var name = String(data[r][1]).trim();
        if (!(name in taskMap)) {
          sheet.deleteRow(r + 1);
        }
      }
    }

    // Re-read after deletions
    data = sheet.getDataRange().getValues();

    // Pass 2: find existing tasks for this month
    var existing = {};
    for (var r2 = 1; r2 < data.length; r2++) {
      if (normMonth(data[r2][0]) === month) {
        var eName = String(data[r2][1]).trim();
        existing[eName] = r2;
        // Update points if changed
        if (taskMap[eName] !== undefined && Number(data[r2][2]) !== taskMap[eName]) {
          sheet.getRange(r2 + 1, 3).setValue(taskMap[eName]);
        }
      }
    }

    // Pass 3: add missing tasks
    tasks.forEach(function(t) {
      if (!existing[t.name]) {
        var row = [month, t.name, t.points];
        for (var i = 0; i < 31; i++) row.push('');
        sheet.appendRow(row);
      }
    });
  });

  return { ok: true };
}

// ===== WRITE: Task definitions =====

function updateTaskDef(month, oldName, newName, newPoints) {
  ['獎勵','待確認'].forEach(function(sheetName) {
    const sheet = getOrCreateSheet(sheetName, rewardHeaders());
    const data = sheet.getDataRange().getValues();
    for (let r = 1; r < data.length; r++) {
      if (normMonth(data[r][0]) === month && String(data[r][1]).trim() === oldName) {
        sheet.getRange(r + 1, 2).setValue(newName);
        sheet.getRange(r + 1, 3).setValue(newPoints);
        break;
      }
    }
  });
  return { ok: true };
}

function deleteTaskDef(month, taskName) {
  ['獎勵','待確認'].forEach(function(sheetName) {
    const sheet = getOrCreateSheet(sheetName, rewardHeaders());
    const data = sheet.getDataRange().getValues();
    for (let r = data.length - 1; r >= 1; r--) {
      if (normMonth(data[r][0]) === month && String(data[r][1]).trim() === taskName) {
        sheet.deleteRow(r + 1);
      }
    }
  });
  return { ok: true };
}

// ===== Settings =====

function saveSetting(key, value) {
  const sheet = getOrCreateSheet('設定', ['key','value']);
  const data = sheet.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (data[r][0] === key) {
      sheet.getRange(r + 1, 2).setValue(value);
      return { ok: true };
    }
  }
  sheet.appendRow([key, value]);
  return { ok: true };
}

// ===== Clear =====

function clearAll() {
  ['書單','獎勵','待確認'].forEach(function(name) {
    const ss = SpreadsheetApp.openById(SS_ID);
    const sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
    }
  });
  return { ok: true };
}

function clearRewardsOnly() {
  ['獎勵','待確認'].forEach(function(name) {
    const ss = SpreadsheetApp.openById(SS_ID);
    const sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
    }
  });
  return { ok: true };
}

// ===== Treasure Box (百寶箱) =====

function readTreasure() {
  const sheet = getOrCreateSheet('百寶箱', TREASURE_COLS);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  return data.slice(1).map(function(row) {
    return {
      id: Number(row[0]) || 0,
      date: fmtDate(row[1]),
      type: String(row[2] || ''),
      diamonds: Number(row[3]) || 0,
      shells: Number(row[4]) || 0,
      note: String(row[5] || ''),
      status: String(row[6] || '已確認')
    };
  });
}

function addTreasure(date, type, diamonds, shells, note, status) {
  const sheet = getOrCreateSheet('百寶箱', TREASURE_COLS);
  const data = sheet.getDataRange().getValues();
  var maxId = 0;
  for (var r = 1; r < data.length; r++) {
    maxId = Math.max(maxId, Number(data[r][0]) || 0);
  }
  var id = maxId + 1;
  sheet.appendRow([id, date || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'), type, diamonds || 0, shells || 0, note || '', status || '已確認']);
  return { ok: true, id: id };
}

function approveTreasureById(id) {
  const sheet = getOrCreateSheet('百寶箱', TREASURE_COLS);
  const data = sheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (Number(data[r][0]) === Number(id)) {
      sheet.getRange(r + 1, 7).setValue('已確認');
      return { ok: true };
    }
  }
  return { error: 'Not found' };
}

function rejectTreasureById(id) {
  const sheet = getOrCreateSheet('百寶箱', TREASURE_COLS);
  const data = sheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (Number(data[r][0]) === Number(id)) {
      sheet.deleteRow(r + 1);
      return { ok: true };
    }
  }
  return { error: 'Not found' };
}
