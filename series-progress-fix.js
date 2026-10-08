(function () {
	"use strict";
	function injectStyles() {
		var css = `
			.card.ep-design-active .card-watched { display: none !important; }
			.ep-watched-layer {
				position: absolute;
				left: 0.4em;
				right: 0.4em;
				bottom: 2.7em;
				z-index: 2;
				background-color: rgba(0, 0, 0, 0.9);
				border-radius: 1em;
				padding: 0.6em 1em 1em 1em;
				box-sizing: border-box;
				font-family: "SegoeUI", sans-serif;
				text-align: left;
				display: flex;
				flex-direction: column;
				pointer-events: none;
				opacity: 0;
				transition: opacity 0.2s ease;
			}
			.card.focus .ep-watched-layer.ep-ready,
			.card:hover .ep-watched-layer.ep-ready {
				opacity: 1;
				transition-delay: 0.3s;
			}
			.ep-watched-body {
				font-size: 0.9em;
				display: flex;
				flex-direction: column;
				width: 100%;
			}
			.ep-watched-item {
				margin-top: 0.3em;
				line-height: 1.6;
			}
			.ep-watched-item.is-active {
				margin-top: 0;
				color: #fff;
			}
			.ep-watched-item:nth-child(2) { color: #9f9f9f; }
			.ep-watched-item:nth-child(3) { color: #6c6c6c; }
			.ep-watched-item:nth-child(4) { color: #5e5e5e; }
			.ep-watched-item:nth-child(5) { color: #4c4c4c; }
			.ep-watched-item > span {
				display: block;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
			.ep-time-line {
				margin-top: 0.5em;
				margin-bottom: 0.3em;
				border-radius: 3em;
				background-color: rgba(255, 255, 255, 0.25);
				height: 0.3em;
				width: 100%;
				overflow: hidden;
			}
			.ep-time-line > div {
				height: 100%;
				border-radius: 3em;
				background-color: #fff;
			}
			.ep-num {
				font-weight: 600;
			}
		`;
		var style = document.getElementById("ep-design-css") || document.createElement("style");
		style.id = "ep-design-css";
		style.innerHTML = css;
		if (!style.parentNode) document.head.appendChild(style);
	}
	function getDaysFromNow(dateStr) {
		if (!dateStr) return -1;
		var date = new Date(dateStr);
		var now = new Date();
		date.setHours(0, 0, 0, 0);
		now.setHours(0, 0, 0, 0);
		var diff = date - now;
		return Math.ceil(diff / (1000 * 60 * 60 * 24));
	}
	function generateVariations(title) {
		if (!title) return [];
		var variations = [title];
		var acronyms = title.match(/[A-Z]{2,}/g);
		if (acronyms) {
			acronyms.forEach(function (acronym) {
				var withBullets = acronym.split("").join("・");
				variations.push(title.replace(acronym, withBullets));
				var withDots = acronym.split("").join(".");
				variations.push(title.replace(acronym, withDots));
				variations.push(title.replace(acronym, withDots + "."));
			});
		}
		var punctuationMap = { "!": "！", "！": "!", "?": "？", "？": "?" };
		var extraVariations = [];
		variations.forEach(function (t) {
			var changed = t
				.split("")
				.map(function (c) {
					return punctuationMap[c] || c;
				})
				.join("");
			if (changed !== t) {
				extraVariations.push(changed);
			}
		});
		return variations.concat(extraVariations);
	}
	function getSeriesProgress(card) {
		var baseKeys = [card.original_name, card.original_title, card.name, card.title].filter(Boolean);
		var keys = [];
		baseKeys.forEach(function (key) {
			generateVariations(key).forEach(function (v) {
				if (keys.indexOf(v) === -1) keys.push(v);
			});
		});
		var cache = Lampa.Storage.get("online_watched_last", "{}") || {};
		var found = null;
		keys.some(function (key) {
			var item = cache[Lampa.Utils.hash(key)];
			if (item && item.episode > 0 && item.season >= 0) {
				found = { season: item.season, episode: item.episode, title: key };
				return true;
			}
		});
		if (found) return found;
		keys.some(function (key) {
			var watched = Lampa.Timeline.watched({ original_name: key }, true);
			var last = Array.isArray(watched) && watched[watched.length - 1];
			if (!last) return false;
			found = { season: 1, episode: last.ep, title: key };
			return true;
		});
		return found;
	}
	function loadEpisodes(card, season, callback) {
		try {
			Lampa.Api.seasons(card, [season], function (data) {
				callback(data && data[season] && Array.isArray(data[season].episodes) ? data[season].episodes : []);
			});
		} catch (e) {
			callback([]);
		}
	}
	function escapeHtml(text) {
		return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}
	function episodeTitle(number, name) {
		return '<span class="ep-num">' + escapeHtml(number) + " -</span> " + escapeHtml(name);
	}
	function drawHTML(cardNode, items) {
		var viewContainer = cardNode.querySelector(".card__view");
		if (!viewContainer) return;
		var layer = viewContainer.querySelector(".ep-watched-layer");
		cardNode.classList.toggle("ep-design-active", items.length > 0);
		if (!items.length) {
			if (layer) layer.remove();
			return;
		}
		var html = items
			.map(function (data) {
				var line = data.percent > 0 ? '<div class="ep-time-line"><div style="width: ' + data.percent + '%"></div></div>' : "";
				return '<div class="ep-watched-item' + (data.isCurrent ? " is-active" : "") + '"><span>' + data.title + "</span>" + line + "</div>";
			})
			.join("");
		if (layer && layer.epHtml === html) return;
		var isNew = !layer;
		if (isNew) {
			layer = document.createElement("div");
			layer.className = "ep-watched-layer";
		}
		layer.innerHTML = '<div class="ep-watched-body">' + html + "</div>";
		layer.epHtml = html;
		if (isNew) {
			viewContainer.appendChild(layer);
			void window.getComputedStyle(layer).opacity;
			layer.classList.add("ep-ready");
		}
	}
	function processSeries(cardNode, cardData) {
		var progress = getSeriesProgress(cardData);
		if (!progress) return drawHTML(cardNode, []);
		var titleKey = progress.title;
		function percentOf(season, episode) {
			var view = Lampa.Timeline.view(Lampa.Utils.hash([season, season > 10 ? ":" : "", episode, titleKey].join("")));
			return (view && view.percent) || 0;
		}
		var fallback = [
			{
				title: episodeTitle(progress.episode, Lampa.Lang.translate("full_episode") + " " + progress.episode),
				percent: percentOf(progress.season, progress.episode),
				isCurrent: true,
			},
		];
		cardNode.classList.add("ep-design-active");
		var request = cardNode.epDesignRequest;
		loadEpisodes(cardData, progress.season, function (episodes) {
			if (request !== cardNode.epDesignRequest) return;
			var currentIndex = episodes.findIndex(function (ep) {
				return ep.episode_number == progress.episode;
			});
			if (currentIndex === -1) return drawHTML(cardNode, fallback);
			episodes.forEach(function (ep, index) {
				if (index > currentIndex && percentOf(ep.season_number, ep.episode_number) > 0) currentIndex = index;
			});
			var nextEp = episodes[currentIndex + 1];
			var listToShow = nextEp && getDaysFromNow(nextEp.air_date) > 0 ? [episodes[currentIndex], nextEp] : episodes.slice(currentIndex, currentIndex + 5);
			var itemsToDraw = listToShow.map(function (ep, i) {
				var days = getDaysFromNow(ep.air_date);
				var isFuture = days > 0;
				var epName = (ep.name || "").replace(new RegExp("^" + ep.episode_number + "([ .-]|$)"), "").trim();
				if (epName === Lampa.Lang.translate("noname")) epName = "";
				if (isFuture) {
					if (days >= 365) epName = "Осталось лет: " + Math.floor(days / 365);
					else if (days >= 30) epName = "Осталось месяцев: " + Math.floor(days / 30);
					else if (days >= 7) epName = "Осталось недель: " + Math.floor(days / 7);
					else epName = "Осталось дней: " + days;
				}
				return {
					title: episodeTitle(ep.episode_number, epName),
					percent: isFuture ? 0 : percentOf(ep.season_number, ep.episode_number),
					isCurrent: i === 0,
				};
			});
			drawHTML(cardNode, itemsToDraw);
		});
	}
	function processMovie(cardNode, cardData) {
		var key = cardData.original_title || cardData.title;
		var viewData = key && Lampa.Timeline.view(Lampa.Utils.hash(key));
		if (!viewData || !viewData.percent) return drawHTML(cardNode, []);
		var timeText = viewData.time > 0 ? Lampa.Utils.secondsToTimeHuman(viewData.time) : viewData.percent + "%";
		drawHTML(cardNode, [
			{
				title: escapeHtml(Lampa.Lang.translate("title_viewed") + " " + timeText),
				percent: viewData.percent,
				isCurrent: true,
			},
		]);
	}
	function renderCard(cardNode, cardData) {
		if (!cardData || cardNode.classList.contains("card--wide")) return;
		cardNode.epDesignRequest = (cardNode.epDesignRequest || 0) + 1;
		var isSeries = cardData.number_of_seasons > 0 || cardData.original_name || cardData.media_type === "tv";
		if (isSeries) {
			processSeries(cardNode, cardData);
		} else {
			processMovie(cardNode, cardData);
		}
	}
	function startPlugin() {
		injectStyles();
		function updateCard(card) {
			var data = card.card_data || card.data || (window.jQuery && window.jQuery(card).data("data"));
			renderCard(card, data);
		}
		function updateFocused() {
			document.querySelectorAll(".card.focus").forEach(updateCard);
		}
		function onCardEvent(e) {
			var card = e.target.closest && e.target.closest(".card");
			if (!card) return;
			if (e.type === "mouseover" && e.relatedTarget && card.contains(e.relatedTarget)) return;
			updateCard(card);
		}
		["hover:focus", "hover:touch", "hover:hover", "mouseover", "update"].forEach(function (event) {
			document.addEventListener(event, onCardEvent, true);
		});
		Lampa.Listener.follow("activity", function (e) {
			if (e.type === "start") setTimeout(updateFocused, 0);
		});
		Lampa.Listener.follow("state:changed", function (e) {
			if (e.target === "timeline" || e.target === "timetable") updateFocused();
		});
		window.addEventListener("tvmaze_loaded", function (e) {
			if (!e.detail || !e.detail.id) return;
			document.querySelectorAll(".card").forEach(function (card) {
				var data = card.card_data || card.data || (window.jQuery && window.jQuery(card).data("data"));
				if (data && data.id == e.detail.id) renderCard(card, data);
			});
		});
		updateFocused();
	}
	if (window.appready) {
		startPlugin();
	} else {
		Lampa.Listener.follow("app", function (e) {
			if (e.type == "ready") startPlugin();
		});
	}
})();
