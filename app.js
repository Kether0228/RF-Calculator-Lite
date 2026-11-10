/* RF 計算核心：所有內部距離統一使用公尺，功率統一使用 dBm。 */
"use strict";

const $ = (selector) => document.querySelector(selector);
const form = $("#rf-form");
const outputDistanceUnit = $("#distance-output-unit");
const outputPowerUnit = $("#power-output-unit");

const numberFrom = (selector) => Number($(selector).value);
const formatNumber = (value, digits = 2) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat("zh-TW", { maximumFractionDigits: digits }).format(value)
    : "—";

const metersFrom = (value, unit) => value * (unit === "km" ? 1000 : 1);
const toDbm = (value, unit) =>
  unit === "W" ? 10 * Math.log10(value * 1000) : value;
const dbmToWatts = (dbm) => 10 ** ((dbm - 30) / 10);
const distanceText = (meters) => {
  const value = outputDistanceUnit.value === "km" ? meters / 1000 : meters;
  return `${formatNumber(value, 3)} ${outputDistanceUnit.value}`;
};
const powerText = (dbm) => outputPowerUnit.value === "W"
  ? `${formatPower(dbmToWatts(dbm))} W`
  : `${formatNumber(dbm, 2)} dBm`;

function formatPower(watts) {
  // 保留瓦特作為輸出單位；極小功率以科學記號避免顯示成 0。
  return `${watts.toExponential(3)} W`;
}

function getParameters() {
  const height = metersFrom(numberFrom("#antenna-height"), $("#height-unit").value);
  const targetDistance = metersFrom(numberFrom("#target-distance"), $("#distance-unit").value);
  const beamwidth = numberFrom("#beamwidth");
  const txPower = numberFrom("#tx-power");
  const txPowerDbm = toDbm(txPower, $("#tx-power-unit").value);
  const antennaGain = numberFrom("#antenna-gain");
  const cableLoss = numberFrom("#cable-loss");
  const frequencies = [...document.querySelectorAll('input[name="frequency"]:checked')]
    .map((input) => Number(input.value));

  return { height, targetDistance, beamwidth, txPowerDbm, antennaGain, cableLoss, frequencies };
}

function validate(parameters) {
  const { height, targetDistance, beamwidth, txPowerDbm, cableLoss, frequencies } = parameters;
  if (![height, targetDistance, beamwidth, txPowerDbm, cableLoss].every(Number.isFinite)) {
    return "請確認所有欄位均為有效數字。";
  }
  if (height <= 0 || targetDistance <= 0) return "天線高度與目標物距離必須大於 0。";
  if (beamwidth <= 0 || beamwidth >= 180) return "垂直波束角必須介於 0 至 180 度之間。";
  if (cableLoss < 0) return "Cable Loss 不可小於 0。";
  if (frequencies.length === 0) return "請至少選擇一個計算頻段。";
  if ($("#tx-power-unit").value === "W" && numberFrom("#tx-power") <= 0) return "RRU 發射功率必須大於 0 W。";
  if ($("#tx-power-unit").value === "dBm" && !Number.isFinite(txPowerDbm)) return "請輸入有效的 dBm 功率。";
  return "";
}

/* 依 Excel 幾何定義：目標物距離是地面水平距離。 */
function calculateGeometry(parameters) {
  const { height, targetDistance, beamwidth } = parameters;
  const centerAngle = Math.atan(targetDistance / height) * 180 / Math.PI;
  const maxAngle = centerAngle + beamwidth / 2;
  const minAngle = centerAngle - beamwidth / 2;

  if (maxAngle >= 90 || minAngle <= 0) {
    throw new Error("目前的波束角度會使涵蓋邊界超出有效幾何範圍（0° 至 90°），請調整距離、高度或波束角。");
  }

  const nearDistance = height * Math.tan(minAngle * Math.PI / 180);
  const farDistance = height * Math.tan(maxAngle * Math.PI / 180);
  const slantDistance = Math.hypot(height, targetDistance);

  return {
    centerAngle, maxAngle, minAngle, nearDistance, farDistance,
    coverageWidth: farDistance - nearDistance,
    tilt: 90 - centerAngle,
    slantDistance
  };
}

function freeSpacePathLoss(distanceMeters, frequencyMHz) {
  // FSPL 標準式：距離以 km、頻率以 MHz 代入。
  return 32.4 + 20 * Math.log10(distanceMeters / 1000) + 20 * Math.log10(frequencyMHz);
}

function calculateLinkBudget(parameters, geometry) {
  const { frequencies, txPowerDbm, antennaGain, cableLoss } = parameters;
  return frequencies.map((frequency) => {
    const fsplNear = freeSpacePathLoss(geometry.nearDistance, frequency);
    const fsplFar = freeSpacePathLoss(geometry.farDistance, frequency);
    const eirpBeforePathLoss = txPowerDbm + antennaGain - cableLoss;
    return {
      frequency,
      fsplNear,
      fsplFar,
      bestRx: eirpBeforePathLoss - fsplNear,
      worstRx: eirpBeforePathLoss - fsplFar
    };
  });
}

function renderGeometry(geometry, parameters) {
  const { centerAngle, maxAngle, minAngle, nearDistance, farDistance } = geometry;
  // SVG 示意圖使用比例縮放，保留相對幾何關係並避免圖形超出畫布。
  const tx = { x: 159, y: 54 };
  const groundY = 300;
  const scale = Math.min(2.0, 650 / Math.max(farDistance, parameters.targetDistance, 1));
  const xAt = (distance) => tx.x + distance * scale;
  const pointAt = (angle) => ({
    x: xAt(parameters.height * Math.tan(angle * Math.PI / 180)),
    y: groundY
  });
  const target = { x: xAt(parameters.targetDistance), y: groundY };
  const near = pointAt(minAngle);
  const far = pointAt(maxAngle);
  const center = pointAt(centerAngle);
  const line = (id, a, b) => {
    const element = document.getElementById(id);
    element.setAttribute("x1", a.x); element.setAttribute("y1", a.y);
    element.setAttribute("x2", b.x); element.setAttribute("y2", b.y);
  };

  $("#beam-area").setAttribute("d", `M ${tx.x} ${tx.y} L ${near.x} ${near.y} L ${far.x} ${far.y} Z`);
  line("beam-upper", tx, far);
  line("beam-lower", tx, near);
  line("center-ray", tx, center);
  line("target-ray", tx, target);
  line("target-post", { x: target.x, y: target.y }, { x: target.x, y: 210 });
  line("near-marker", { x: near.x, y: 300 }, { x: near.x, y: 318 });
  line("far-marker", { x: far.x, y: 300 }, { x: far.x, y: 318 });
  $("#tx-point").setAttribute("cx", tx.x); $("#tx-point").setAttribute("cy", tx.y);
  $("#target-point").setAttribute("cx", target.x); $("#target-point").setAttribute("cy", target.y);
  $("#target-label").setAttribute("x", Math.min(target.x + 10, 760));
  $("#target-label").setAttribute("y", 205);
  $("#near-label").setAttribute("x", near.x); $("#near-label").setAttribute("y", 338);
  $("#near-label").setAttribute("text-anchor", "middle");
  $("#far-label").setAttribute("x", far.x); $("#far-label").setAttribute("y", 338);
  $("#far-label").setAttribute("text-anchor", "middle");
  $("#center-angle-label").setAttribute("x", tx.x + 95);
  $("#center-angle-label").setAttribute("y", tx.y + 75);
  $("#center-angle-label").textContent = `中心角 ${formatNumber(centerAngle, 2)}°`;
  // 目標點及涵蓋邊界採相同水平比例，必要時縮小整體圖面。
  const viewBoxWidth = Math.max(900, Math.min(1300, far.x + 100));
  $("#coverage-diagram").setAttribute("viewBox", `0 0 ${viewBoxWidth} 390`);
}

function renderResults(geometry, linkResults) {
  $("#out-slant").textContent = distanceText(geometry.slantDistance);
  $("#out-center-angle").textContent = `${formatNumber(geometry.centerAngle)}°`;
  $("#out-tilt").textContent = `${formatNumber(geometry.tilt)}°`;
  $("#out-coverage").textContent = distanceText(geometry.coverageWidth);
  $("#out-max-angle").textContent = `${formatNumber(geometry.maxAngle)}°`;
  $("#out-min-angle").textContent = `${formatNumber(geometry.minAngle)}°`;
  $("#out-near-distance").textContent = distanceText(geometry.nearDistance);
  $("#out-far-distance").textContent = distanceText(geometry.farDistance);

  $("#rf-results").innerHTML = linkResults.map((result) => `
    <tr>
      <td>${formatNumber(result.frequency, 0)} MHz</td>
      <td>${formatNumber(result.fsplNear)} dB</td>
      <td>${formatNumber(result.fsplFar)} dB</td>
      <td class="best-value">${powerText(result.bestRx)}</td>
      <td class="worst-value">${powerText(result.worstRx)}</td>
    </tr>
  `).join("");
}

function calculate() {
  $("#form-error").textContent = "";
  const parameters = getParameters();
  const validationMessage = validate(parameters);
  if (validationMessage) {
    $("#form-error").textContent = validationMessage;
    return;
  }

  try {
    const geometry = calculateGeometry(parameters);
    const linkResults = calculateLinkBudget(parameters, geometry);
    renderResults(geometry, linkResults);
    renderGeometry(geometry, parameters);
  } catch (error) {
    $("#form-error").textContent = error.message;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  calculate();
});

// 切換輸出單位時，沿用目前輸入值重新計算與格式化。
outputDistanceUnit.addEventListener("change", calculate);
outputPowerUnit.addEventListener("change", calculate);

// 初始畫面載入時先呈現預設參數的計算結果。
calculate();
