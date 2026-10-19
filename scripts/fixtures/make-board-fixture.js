#!/usr/bin/env node
/**
 * Builds a small fixture of a board page that carries the rendered cards but
 * not the deferred loader call.
 *
 * The real site answers that way often - measured on 2026-10-19: 5 of 12
 * requests had the cards but no deferred JSON - so the cards are the path
 * that has to work. The markup is taken from a real response, cut down to
 * two cards, and the class names keep their random suffixes because the
 * reader matches on the prefix.
 */
const fs = require("fs");
const path = require("path");

const card = (id, rank, title, heat, cover, description, tags) => `
<article class="pc-item-jlQoVk " aria-labelledby="rank-title-${id}">
<a class="pc-cover-link-Qbvkrw" aria-label="查看${title}" href="/detail?series_id=${id}">
<picture style="display:contents"><source srcSet="${cover}.webp" type="image/webp"/>
<img class="pc-cover-VgjqQf" src="${cover}" alt="${title}封面" fetchpriority="high" width="160" height="224"/></picture>
<span class="pc-badge-guiMWE"><svg class="pc-badge-background-DuT8VG" viewBox="0 0 22 20" fill="none" preserveAspectRatio="none" aria-hidden="true"><use href="#rank-real-badgeDefault"></use></svg><span class="pc-badge-number-LCKjbJ">${rank}</span></span></a>
<div class="pc-content-_hELEg"><div class="pc-heading-iLIXC9"><a href="/detail?series_id=${id}">
<h2 id="rank-title-${id}" class="pc-title-LHxn_J">${title}</h2></a>
<p class="pc-metrics-tBwLTq"><span><svg class="pc-heat-icon-bpJYzZ" viewBox="0 0 14 14" fill="none" preserveAspectRatio="none" aria-hidden="true"><use href="#rank-real-heat"></use></svg>${heat}</span></p></div>
<ul class="pc-engagement-_1DgDL" aria-label="作品互动数据"><li class="pc-score-tag-bG08FR">评分8.0</li><li>32.7万收藏</li></ul>
<p class="pc-categories-ApVUzG"><span>${tags[0]}</span><svg class="pc-category-divider-zW7WOD" viewBox="0 0 2 2" fill="none" preserveAspectRatio="none" aria-hidden="true"><use href="#rank-real-categoryDivider"></use></svg><span>${tags[1]}</span></p>
<p class="pc-description-feL298">${description}</p>
<div class="pc-episodes-MJlIL5" aria-label="${title}选集"></div></div></article>`;

const cards =
    card(
        "7685265188223732761",
        21,
        "从东北来的她",
        "4892万热度",
        "https://p3-novel.byteimg.com/novel-pic/7f3bd45397c72e352e4699e2cde816ae~tplv-shrink:640:0.image",
        "东北神人屯长大的秋野，被接回京城沈家。",
        ["家庭", "家庭伦理"]
    ) +
    card(
        "7694653385668037657",
        22,
        "王妈在顾家当保姆后全家只会搞笑了",
        "6664万热度",
        "https://p6-novel.byteimg.com/novel-pic/f46efa4c55e9b146f7d4906fd88ceb4e~tplv-shrink:640:0.image",
        "王妈在顾家当保姆后，全家都变了样。",
        ["家庭", "逆袭"]
    );

const router = {
    loaderData: {
        "rank_hot-real-drama/page": {
            rankKey: "real",
            pageNum: 2,
            previousUrl: "https://hongguoduanju.com/rank/hot-real-drama",
            updatedText: "10月19日已更新 · 基于红果内观看/互动等综合热度排序",
            content: {},
        },
    },
};

const nav = `<nav class="pc-pagination-CkIOH3" aria-label="榜单分页">
<a class="pc-direction-dfLMIp" href="/rank/hot-real-drama" rel="prev" aria-label="上一页"></a>
<a class="pc-page-cUKmig" href="/rank/hot-real-drama" aria-label="第 1 页">1</a>
<span class="pc-current-sgRm7A" aria-current="page">2</span>
<a class="pc-page-cUKmig" href="/rank/hot-real-drama?page=3" aria-label="第 3 页">3</a>
<a class="pc-page-cUKmig" href="/rank/hot-real-drama?page=4" aria-label="第 4 页">4</a>
<a class="pc-page-cUKmig" href="/rank/hot-real-drama?page=5" aria-label="第 5 页">5</a>
<a class="pc-direction-dfLMIp" href="/rank/hot-real-drama?page=3" rel="next" aria-label="下一页"></a></nav>`;

const html = `<!DOCTYPE html><html><head><title>热播榜</title></head><body>
<main class="pc-list-x1">${cards}</main>
${nav}
<script id="_ROUTER_DATA" type="application/json">${JSON.stringify(router)}</script>
</body></html>`;

const out = path.join(__dirname, "board-rendered.html");
fs.writeFileSync(out, html, "utf8");
console.log("wrote " + out + " (" + html.length + " bytes)");
