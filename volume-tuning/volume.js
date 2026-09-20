/* Copyright 2013 The ChromiumOS Authors
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

var speaker_section;
var headphone_section;

window.onload = function() {
  speaker_section = new CurveSection('speaker');
  speaker_section.init({ minIdx: 1, maxIdx: 15, stepIdx: 1 });

  headphone_section = new CurveSection('headphone');
  headphone_section.init({ minIdx: 1, maxIdx: 15, stepIdx: 1 });

  toggle_format();
};

function toggle_format() {
  var formatEl = document.querySelector('input[name="config_format"]:checked');
  var format = formatEl ? formatEl.value : 'android';
  var speakerTitle = document.getElementById('speaker_title');
  var headphoneSection = document.getElementById('headphone_section');

  if (format === 'android') {
    speakerTitle.style.display = 'block';
    headphoneSection.style.display = 'block';
    if (speaker_section) speaker_section.setIndexDefaults(1, 15, 1);
    if (headphone_section) headphone_section.setIndexDefaults(1, 15, 1);
  } else {
    speakerTitle.style.display = 'none';
    headphoneSection.style.display = 'none';
    if (speaker_section) speaker_section.setIndexDefaults(0, 100, 4);
  }
}

function CurveSection(prefix) {
  this.prefix = prefix;
  this.minmax_boxes = []; // The text input boxes for min/max/step
  this.index_boxes = [];  // The text input boxes for min/max/step index
  this.fix_boxes = {};    // Map index -> input element
  this.canvas = document.getElementById('curve_' + prefix);
}

CurveSection.prototype.getMinIdx = function() { return this.index_boxes[0] ? parseInt(this.index_boxes[0].value) : 0; };
CurveSection.prototype.getMaxIdx = function() { return this.index_boxes[1] ? parseInt(this.index_boxes[1].value) : 100; };
CurveSection.prototype.getStepIdx = function() { return this.index_boxes[2] ? parseInt(this.index_boxes[2].value) : 4; };

CurveSection.prototype.init = function(defaults) {
  this.init_minmax();
  this.init_index_boxes(defaults);
  this.rebuild_fixes();
  this.redraw();
};

CurveSection.prototype.setIndexDefaults = function(minIdx, maxIdx, stepIdx) {
  if (this.index_boxes.length >= 3) {
    this.index_boxes[0].value = minIdx;
    this.index_boxes[1].value = maxIdx;
    this.index_boxes[2].value = stepIdx;
    this.rebuild_fixes();
  }
};

// Create min/max/step boxes
CurveSection.prototype.init_minmax = function() {
  var table = document.getElementById('minmax_' + this.prefix);
  var names = ['Min:' , 'Max:', 'Step:'];
  var self = this;
  for (var i = 0; i < names.length; i++) {
    var row = table.insertRow(-1);
    var col_name = row.insertCell(-1);
    var col_box = row.insertCell(-1);
    var col_db = row.insertCell(-1);
    var box = document.createElement('input');
    box.size = 5;
    box.className = 'box';
    col_name.appendChild(document.createTextNode(names[i]));
    col_name.align = 'right';
    col_box.appendChild(box);
    col_db.appendChild(document.createTextNode('dB'));
    self.minmax_boxes.push(box);
    box.oninput = function() { self.redraw(); };
  }
};

// Create Min Index, Max Index, Index Step inputs at top of fixes table
CurveSection.prototype.init_index_boxes = function(defaults) {
  var table = document.getElementById('fixes_' + this.prefix);
  var indexFields = [
    { label: 'Min Index:', val: defaults ? defaults.minIdx : 0 },
    { label: 'Max Index:', val: defaults ? defaults.maxIdx : 100 },
    { label: 'Index Step:', val: defaults ? defaults.stepIdx : 4 }
  ];
  var self = this;
  for (var i = 0; i < indexFields.length; i++) {
    var row = table.insertRow(-1);
    var col_name = row.insertCell(-1);
    var col_box = row.insertCell(-1);
    row.insertCell(-1);

    var box = document.createElement('input');
    box.size = 5;
    box.className = 'box';
    box.value = indexFields[i].val;
    col_name.appendChild(document.createTextNode(indexFields[i].label));
    col_name.align = 'right';
    col_box.appendChild(box);
    self.index_boxes.push(box);
    box.oninput = function() { self.rebuild_fixes(); };
  }

  var sepRow = table.insertRow(-1);
  var sepCell = sepRow.insertCell(-1);
  sepCell.colSpan = 3;
  sepCell.innerHTML = '<hr style="border: 0; border-top: 1px solid #a0b8d9; margin: 4px 0;">';
};

CurveSection.prototype.rebuild_fixes = function() {
  var table = document.getElementById('fixes_' + this.prefix);
  while (table.rows.length > 4) {
    table.deleteRow(4);
  }

  var minIdx = this.getMinIdx();
  var maxIdx = this.getMaxIdx();
  var stepIdx = this.getStepIdx();

  if (isNaN(minIdx) || isNaN(maxIdx) || isNaN(stepIdx) || stepIdx <= 0 || minIdx >= maxIdx) {
    this.fix_boxes = {};
    this.redraw();
    return;
  }

  var oldFixes = this.fix_boxes || {};
  this.fix_boxes = {};
  var self = this;

  for (var i = minIdx; i <= maxIdx; i += stepIdx) {
    var row = table.insertRow(-1);
    var col_name = row.insertCell(-1);
    var col_box = row.insertCell(-1);
    var col_db = row.insertCell(-1);
    var box = document.createElement('input');
    box.size = 5;
    box.className = 'box';

    if (oldFixes[i] && oldFixes[i].value !== undefined) {
      box.value = oldFixes[i].value;
    }

    col_name.appendChild(document.createTextNode(i + ':'));
    col_name.align = 'right';
    col_box.appendChild(box);
    col_db.appendChild(document.createTextNode('dB'));
    self.fix_boxes[i] = box;
    box.oninput = function() { self.redraw(); };
  }

  this.redraw();
};

CurveSection.prototype.getFixIndices = function() {
  var indices = [];
  for (var k in this.fix_boxes) {
    indices.push(parseInt(k));
  }
  indices.sort(function(a, b) { return a - b; });
  return indices;
};

// Redraw everything on the canvas. This is run every time any input is changed.
CurveSection.prototype.redraw = function() {
  var backgroundColor = 'black';
  var gridColor = 'rgb(200,200,200)';
  var dotColor = 'rgb(245,245,0)';
  var marginLeft = 60;
  var marginBottom = 30;
  var marginTop = 20;
  var marginRight = 30;
  var canvas = this.canvas || document.getElementById('curve_' + this.prefix);
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var w = 800;
  var h = 400;
  canvas.width = w + marginLeft + marginRight;
  canvas.height = h + marginBottom + marginTop;
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 1;
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';

  // Set up coordinate system
  ctx.translate(marginLeft, h + marginTop);
  ctx.scale(1, -1);

  // Draw two lines at x = 0 and y = 0 which are solid lines
  ctx.strokeStyle = gridColor;
  ctx.beginPath();
  ctx.moveTo(0, h + marginTop / 2);
  ctx.lineTo(0, 0);
  ctx.lineTo(w + marginRight / 2, 0);
  ctx.stroke();

  var minIdx = this.getMinIdx();
  var maxIdx = this.getMaxIdx();
  if (isNaN(minIdx) || isNaN(maxIdx) || minIdx >= maxIdx) return;

  var idxRange = maxIdx - minIdx;
  var fixIndices = this.getFixIndices();

  // Draw vertical lines and labels on x axis
  ctx.strokeStyle = gridColor;
  ctx.fillStyle = gridColor;
  ctx.beginPath();
  ctx.setLineDash([1, 4]);
  for (var i = 0; i < fixIndices.length; i++) {
    var fix_pos = fixIndices[i];
    var x = (fix_pos - minIdx) / idxRange * w;
    if (i > 0) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h + marginTop / 2);
    }
    drawText(ctx, fix_pos, x, -20, 'center');
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw horizontal lines and labels on y axis
  var min = parseFloat(this.minmax_boxes[0].value);
  var max = parseFloat(this.minmax_boxes[1].value);
  var step = parseFloat(this.minmax_boxes[2].value);

  // Soundness checks
  if (isNaN(min) || isNaN(max) || isNaN(step)) return;
  if (min >= max || step <= 0 || (max - min) / step > 10000) return;

  // Let s = minimal multiple of step such that
  // vdivs = Math.round((max - min) / s) <= 20
  var vdivs;
  var s = Math.max(1, Math.floor((max - min) / 20 / step)) * step;
  while (true) {
    var vdivs = Math.round((max - min) / s);
    if (vdivs <= 20) break;
    s += step;
  }

  // Scale from v to y is
  // y = (v - min) / s * h / vdivs
  ctx.strokeStyle = gridColor;
  ctx.fillStyle = gridColor;
  ctx.beginPath();
  ctx.setLineDash([1, 4]);
  for (var i = 0;; i++) {
    var v = min + s * i;
    var y;
    if (v <= max) {
      y = i * h / vdivs;
    } else {
      v = max;
      y = (max - min) / s * h / vdivs;
    }
    drawText(ctx, v.toFixed(2), -5 , y - 4, 'right');
    if (i > 0) {
      ctx.moveTo(0, y);
      ctx.lineTo(w + marginRight / 2, y);
    }
    if (v >= max) break;
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw fixed points
  ctx.strokeStyle = dotColor;
  ctx.fillStyle = dotColor;
  for (var i = 0; i < fixIndices.length; i++) {
    var fix_pos = fixIndices[i];
    var v = this.getFix(fix_pos);
    if (isNaN(v)) continue;
    var x = (fix_pos - minIdx) / idxRange * w;
    var y = (v - min) / s * h / vdivs;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, 2 * Math.PI);
    ctx.stroke();
  }

  // Draw interpolated points
  var points = this.generatePoints();
  for (var i = minIdx; i <= maxIdx; i++) {
    var v = points[i];
    if (isNaN(v)) continue;
    var x = (i - minIdx) / idxRange * w;
    var y = (v - min) / s * h / vdivs;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.fill();
  }
};

// Returns the value of the fixed point with index i
CurveSection.prototype.getFix = function(i) {
  if (!this.fix_boxes[i]) return NaN;
  var v = parseFloat(this.fix_boxes[i].value);
  var min = parseFloat(this.minmax_boxes[0].value);
  var max = parseFloat(this.minmax_boxes[1].value);

  if (isNaN(v)) return v;
  if (v > max) v = max;
  if (v < min) v = min;
  return v;
};

// Returns a value quantized to the given min/max/step
CurveSection.prototype.quantize = function(v) {
  var min = parseFloat(this.minmax_boxes[0].value);
  var max = parseFloat(this.minmax_boxes[1].value);
  var step = parseFloat(this.minmax_boxes[2].value);

  v = min + Math.round((v - min) / step) * step;
  if (isNaN(v)) return v;
  if (v > max) v = max;
  if (v < min) v = min;
  return v;
};

// Generate points indexed by 0 to NN, using interpolation and quantization
CurveSection.prototype.generatePoints = function() {
  // Go through all points, for each point:
  // (1) Find the left fix: the max defined fixed point <= current point
  // (2) Find the right fix: the min defined fixed point >= current point
  // (3) If both exist, interpolate value for current point
  // (4) Otherwise skip current point

  var minIdx = this.getMinIdx();
  var maxIdx = this.getMaxIdx();
  if (isNaN(minIdx) || isNaN(maxIdx) || minIdx >= maxIdx) return [];

  var fixIndices = this.getFixIndices();
  var self = this;

  // Returns left fix index for current point, or NaN if it does not exist
  var find_left = function(current) {
    for (var i = fixIndices.length - 1; i >= 0; i--) {
      var fix_pos = fixIndices[i];
      if (fix_pos <= current && !isNaN(self.getFix(fix_pos))) {
        return fix_pos;
      }
    }
    return NaN;
  };

  // Returns right fix index for current point, or NaN if it does not exist
  var find_right = function(current) {
    for (var i = 0; i < fixIndices.length; i++) {
      var fix_pos = fixIndices[i];
      if (fix_pos >= current && !isNaN(self.getFix(fix_pos))) {
        return fix_pos;
      }
    }
    return NaN;
  };

  // Interpolate value for point x
  var interpolate = function(x) {
    var left = find_left(x);
    if (isNaN(left)) return NaN;

    var right = find_right(x);
    if (isNaN(right)) return NaN;

    var xl = left;
    var xr = right;
    var yl = self.getFix(left);
    var yr = self.getFix(right);

    if (xl == xr) return yl;

    return yl + (yr - yl) * (x - xl) / (xr - xl);
  };

  var result = [];
  for (var x = minIdx; x <= maxIdx; x++) {
    result[x] = self.quantize(interpolate(x));
  }
  return result;
};

function drawText(ctx, s, x, y, align) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, -1);
  ctx.textAlign = align;
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

// The output config file looks like:
//
// [Speaker]
//   volume_curve = explicit
//   db_at_100 = 0
//   db_at_99 = -75
//   db_at_98 = -75
//   ...
//   db_at_1 = -4500
//   db_at_0 = -4800
// [Headphone]
//   volume_curve = simple_step
//   volume_step = 70
//   max_volume = 0
//
function download_config() {
  var formatEl = document.querySelector('input[name="config_format"]:checked');
  var format = formatEl ? formatEl.value : 'android';

  if (format === 'android') {
    var content = "<?xml version='1.0' encoding='utf-8'?>\n<volumes>\n";

    var sMin = speaker_section.getMinIdx();
    var sMax = speaker_section.getMaxIdx();
    var speakerPoints = speaker_section.generatePoints();
    var lastS = 0;
    content += '    <reference name="Speaker">\n';
    for (var i = sMin; i <= sMax; i++) {
      var v = speakerPoints[i];
      if (v === undefined || isNaN(v)) {
        v = lastS;
      } else {
        lastS = v;
      }
      var mb = Math.round(v * 100);
      content += '        <point>' + i + ',' + mb + '</point>\n';
    }
    content += '    </reference>\n';

    var hMin = headphone_section.getMinIdx();
    var hMax = headphone_section.getMaxIdx();
    var headphonePoints = headphone_section.generatePoints();
    var lastH = 0;
    content += '    <reference name="Headphone">\n';
    for (var i = hMin; i <= hMax; i++) {
      var v = headphonePoints[i];
      if (v === undefined || isNaN(v)) {
        v = lastH;
      } else {
        lastH = v;
      }
      var mb = Math.round(v * 100);
      content += '        <point>' + i + ',' + mb + '</point>\n';
    }
    content += '    </reference>\n';
    content += '</volumes>\n';

    save_config(content, 'volume_curves.xml');
  } else {
    var content = '';
    content += '[Speaker]\n';
    content += '  volume_curve = explicit\n';
    var minIdx = speaker_section.getMinIdx();
    var maxIdx = speaker_section.getMaxIdx();
    var points = speaker_section.generatePoints();
    var last = 0;
    for (var i = maxIdx; i >= minIdx; i--) {
      var v = points[i];
      if (isNaN(points[i])) v = last;
      else last = v;
      content += '  db_at_' + i + ' = ' + Math.round(v * 100) + '\n';
    }

    content += '[Headphone]\n';
    content += '  volume_curve = simple_step\n';
    content += '  volume_step = 70\n';
    content += '  max_volume = 0\n';
    save_config(content, 'HDA Intel PCH');
  }
}

function save_config(content, filename) {
  var a = document.getElementById('save_config_anchor');
  var uriContent = 'data:application/octet-stream,' +
      encodeURIComponent(content);
  a.href = uriContent;
  a.download = filename || 'HDA Intel PCH';
  a.click();
}
