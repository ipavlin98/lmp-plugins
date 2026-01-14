(function () {
	"use strict";

	var preloadQueue = [];
	var isPreloading = false;
	var preloadTimer = null;

	function preloadRating(card) {
		if (!card || !card.id) return;

		var cache = Lampa.Storage.get("kp_rating", "{}");
		if (typeof cache === "string") {
			try {
				cache = JSON.parse(cache);
			} catch (e) {
				cache = {};
			}
		}
		if (cache[card.id]) return;

		var inQueue = preloadQueue.some(function (c) {
			return c.id === card.id;
		});
		if (inQueue) return;

		preloadQueue.push(card);

		if (!isPreloading) {
			processPreloadQueue();
		}
	}

	function processPreloadQueue() {
		if (preloadQueue.length === 0) {
			isPreloading = false;
			return;
		}

		isPreloading = true;
		var card = preloadQueue.shift();

		fetchRating(card, function () {
			fetchCubRating(card, function () {
				setTimeout(processPreloadQueue, 50);
			});
		});
	}

	function fetchRating(card, callback) {
		var network = new Lampa.Reguest();
		var title = kpCleanTitle(card.title || card.name || "");
		var searchDate =
			card.release_date || card.first_air_date || card.last_air_date || "0000";
		var searchYear = parseInt((searchDate + "").slice(0, 4));
		var orig = card.original_title || card.original_name;
		var apiUrl = "https://kinopoiskapiunofficial.tech/";
		var ratingUrl = "https://rating.kinopoisk.ru/";
		var headers = { "X-API-KEY": "cf4d8e72-0ef2-47b7-a5fd-08e7ad3a2939" };

		var url =
			apiUrl +
			"api/v2.1/films/search-by-keyword?keyword=" +
			encodeURIComponent(title);
		if (card.imdb_id) {
			url =
				apiUrl + "api/v2.2/films?imdbId=" + encodeURIComponent(card.imdb_id);
		}

		network.timeout(8000);
		network.silent(
			url,
			function (json) {
				var items = json.items || json.films || [];
				if (!items.length && card.imdb_id) {
					network.clear();
					network.timeout(8000);
					network.silent(
						apiUrl +
							"api/v2.1/films/search-by-keyword?keyword=" +
							encodeURIComponent(title),
						function (json2) {
							var items2 = json2.items || json2.films || [];
							processItems(
								items2,
								card,
								searchYear,
								orig,
								apiUrl,
								ratingUrl,
								headers,
								network,
								callback
							);
						},
						function () {
							saveCache(card.id, 0, 0);
							if (callback) callback();
						},
						false,
						{ headers: headers }
					);
				} else {
					processItems(
						items,
						card,
						searchYear,
						orig,
						apiUrl,
						ratingUrl,
						headers,
						network,
						callback
					);
				}
			},
			function () {
				saveCache(card.id, 0, 0);
				if (callback) callback();
			},
			false,
			{ headers: headers }
		);
	}

	function processItems(
		items,
		card,
		searchYear,
		orig,
		apiUrl,
		ratingUrl,
		headers,
		network,
		callback
	) {
		var cardTitle = card.title || card.name;

		if (!items || !items.length) {
			saveCache(card.id, 0, 0);
			if (callback) callback();
			return;
		}

		items.forEach(function (c) {
			var year = c.start_date || c.year || "0000";
			c.tmp_year = parseInt((year + "").slice(0, 4));
		});

		var found = null;

		if (card.imdb_id) {
			var byImdb = items.filter(function (e) {
				return (e.imdb_id || e.imdbId) == card.imdb_id;
			});
			if (byImdb.length === 1) {
				found = byImdb[0];
			}
		}

		if (!found && orig) {
			var byOrig = items.filter(function (e) {
				return (
					equalTitle(e.nameOriginal || e.orig_title, orig) ||
					equalTitle(e.nameEn || e.en_title, orig) ||
					equalTitle(e.nameRu || e.ru_title || e.title, orig)
				);
			});
			if (byOrig.length === 1) {
				found = byOrig[0];
			} else if (byOrig.length > 1) {
				var byYear = byOrig.filter(function (c) {
					return c.tmp_year === searchYear;
				});
				if (byYear.length === 1) {
					found = byYear[0];
				}
			}
		}

		if (!found && cardTitle) {
			var byTitle = items.filter(function (e) {
				return (
					equalTitle(e.nameRu || e.ru_title || e.title, cardTitle) ||
					equalTitle(e.nameEn || e.en_title, cardTitle) ||
					equalTitle(e.nameOriginal || e.orig_title, cardTitle)
				);
			});
			if (byTitle.length === 1) {
				found = byTitle[0];
			} else if (byTitle.length > 1) {
				var byYear = byTitle.filter(function (c) {
					return c.tmp_year === searchYear;
				});
				if (byYear.length === 1) {
					found = byYear[0];
				}
			}
		}

		if (!found && searchYear) {
			var byYear = items.filter(function (c) {
				return (
					c.tmp_year &&
					c.tmp_year >= searchYear - 1 &&
					c.tmp_year <= searchYear + 1
				);
			});
			if (byYear.length === 1) {
				found = byYear[0];
			}
		}

		if (!found) {
			saveCache(card.id, 0, 0);
			if (callback) callback();
			return;
		}

		var kpId =
			found.kp_id || found.kinopoisk_id || found.kinopoiskId || found.filmId;
		if (!kpId) {
			saveCache(card.id, 0, 0);
			if (callback) callback();
			return;
		}

		network.clear();
		network.timeout(5000);
		network["native"](
			ratingUrl + kpId + ".xml",
			function (str) {
				if (str.indexOf("<rating>") >= 0) {
					try {
						var xml = $($.parseXML(str));
						var kp = parseFloat(xml.find("kp_rating").text()) || 0;
						var imdb = parseFloat(xml.find("imdb_rating").text()) || 0;
						saveCache(card.id, kp, imdb);
						if (callback) callback();
						return;
					} catch (e) {}
				}
				fetchFromApi(kpId, card.id, apiUrl, headers, network, callback);
			},
			function () {
				fetchFromApi(kpId, card.id, apiUrl, headers, network, callback);
			},
			false,
			{ dataType: "text" }
		);
	}

	function fetchFromApi(kpId, cardId, apiUrl, headers, network, callback) {
		network.clear();
		network.timeout(8000);
		network.silent(
			apiUrl + "api/v2.2/films/" + kpId,
			function (data) {
				var kp = data.ratingKinopoisk || 0;
				var imdb = data.ratingImdb || 0;
				saveCache(cardId, kp, imdb);
				if (callback) callback();
			},
			function () {
				saveCache(cardId, 0, 0);
				if (callback) callback();
			},
			false,
			{ headers: headers }
		);
	}

	function saveCache(id, kp, imdb, cub) {
		var cache = Lampa.Storage.get("kp_rating", "{}");
		if (typeof cache === "string") {
			try {
				cache = JSON.parse(cache);
			} catch (e) {
				cache = {};
			}
		}

		var keys = Object.keys(cache);

		if (keys.length >= 500) {
			var oldest = keys
				.sort(function (a, b) {
					return (cache[a].timestamp || 0) - (cache[b].timestamp || 0);
				})
				.slice(0, 100);
			oldest.forEach(function (k) {
				delete cache[k];
			});
		}

		var entry = { kp: kp, imdb: imdb, timestamp: Date.now() };
		if (cub !== undefined) entry.cub = cub;
		else if (cache[id] && cache[id].cub) entry.cub = cache[id].cub;
		cache[id] = entry;
		Lampa.Storage.set("kp_rating", cache);
	}

	function saveCubCache(id, cubData) {
		var cache = Lampa.Storage.get("kp_rating", "{}");
		if (typeof cache === "string") {
			try {
				cache = JSON.parse(cache);
			} catch (e) {
				cache = {};
			}
		}

		if (cache[id]) {
			cache[id].cub = cubData;
			cache[id].timestamp = Date.now();
		} else {
			cache[id] = { kp: 0, imdb: 0, cub: cubData, timestamp: Date.now() };
		}
		Lampa.Storage.set("kp_rating", cache);
	}

	function fetchCubRating(card, callback) {
		if (!card || !card.id) {
			if (callback) callback();
			return;
		}

		var cached = getCache(card.id);
		if (cached && cached.cub !== undefined) {
			if (callback) callback();
			return;
		}

		var isTv = !!(card.name || card.first_air_date);
		var method = isTv ? "tv" : "movie";
		var cubDomain = Lampa.Manifest.cub_domain;
		var url =
			Lampa.Utils.protocol() +
			cubDomain +
			"/api/reactions/get/" +
			method +
			"_" +
			card.id;

		var network = new Lampa.Reguest();
		network.timeout(5000);
		network.silent(
			url,
			function (json) {
				var cubData = null;
				if (json && json.result && json.result.length) {
					cubData = json.result;
				}
				saveCubCache(card.id, cubData);
				if (callback) callback();
			},
			function () {
				saveCubCache(card.id, null);
				if (callback) callback();
			}
		);
	}

	function getCache(id) {
		var cache = Lampa.Storage.get("kp_rating", "{}");
		if (typeof cache === "string") {
			try {
				cache = JSON.parse(cache);
			} catch (e) {
				cache = {};
			}
		}

		if (cache[id]) {
			var age = Date.now() - cache[id].timestamp;
			if (age < 86400000) return cache[id];
			delete cache[id];
			Lampa.Storage.set("kp_rating", cache);
		}
		return null;
	}

	function cleanTitle(str) {
		return str.replace(/[\s.,:;''`!?]+/g, " ").trim();
	}

	function kpCleanTitle(str) {
		return cleanTitle(str)
			.replace(/^[ \/\\]+/, "")
			.replace(/[ \/\\]+$/, "")
			.replace(/\+( *[+\/\\])+/g, "+")
			.replace(/([+\/\\] *)+\+/g, "+")
			.replace(/( *[\/\\]+ *)+/g, "+");
	}

	function normalizeTitle(str) {
		return cleanTitle(
			str
				.toLowerCase()
				.replace(/[\-\u2010-\u2015\u2E3A\u2E3B\uFE58\uFE63\uFF0D]+/g, "-")
				.replace(/ё/g, "е")
		);
	}

	function equalTitle(t1, t2) {
		return (
			typeof t1 === "string" &&
			typeof t2 === "string" &&
			normalizeTitle(t1) === normalizeTitle(t2)
		);
	}

	function findCardData(element) {
		if (!element) return null;
		var node = element.jquery ? element[0] : element;
		var steps = 0;
		while (node && !node.card_data && steps < 15) {
			node = node.parentNode;
			steps++;
		}
		return node && node.card_data ? node.card_data : null;
	}

	function preloadVisibleCards() {
		clearTimeout(preloadTimer);
		preloadTimer = setTimeout(function () {
			var layer = $(".layer--visible");
			if (!layer.length) layer = $("body");

			var cards = layer.find(
				".card, .card--small, .card--collection, .card-parser"
			);

			if (cards.length === 0) {
				var cardViews = layer.find(".card__view");
				if (cardViews.length) {
					cards = cardViews.parent();
				}
			}

			cards.each(function () {
				var data = findCardData(this);
				if (data && data.id) {
					preloadRating(data);
				}
			});
		}, 300);
	}

	function setupObserver() {
		var observer = new MutationObserver(function (mutations) {
			for (var i = 0; i < mutations.length; i++) {
				var added = mutations[i].addedNodes;
				for (var j = 0; j < added.length; j++) {
					var node = added[j];
					if (node.nodeType === 1 && node.classList) {
						if (
							node.classList.contains("card") ||
							(node.querySelector && node.querySelector(".card"))
						) {
							preloadVisibleCards();
							return;
						}
					}
				}
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
	}

	function showRating(data, render) {
		if (!render) {
			var activity = Lampa.Activity.active();
			if (activity && activity.activity) render = activity.activity.render();
		}
		if (!render || !data) return;

		$(".wait_rating", render).remove();

		var kp = parseFloat(data.kp);
		var imdb = parseFloat(data.imdb);
		var $kp = $(".rate--kp", render);
		var $imdb = $(".rate--imdb", render);

		if (!isNaN(kp) && kp > 0) {
			$kp.removeClass("hide").find("> div").eq(0).text(kp.toFixed(1));
			applyRatingColor($kp.find("> div").eq(0), $kp.find("> div").last());
		}

		if (!isNaN(imdb) && imdb > 0) {
			$imdb.removeClass("hide").find("> div").eq(0).text(imdb.toFixed(1));
			applyRatingColor($imdb.find("> div").eq(0), $imdb.find("> div").last());
		}
	}

	function applyRatingColor(element, labelElement) {
		if (!Lampa.Storage.get("si_colored_ratings", true)) return;

		var $el = $(element);
		var voteText = $el.text().trim();
		var match = voteText.match(/(\d+(\.\d+)?)/);
		if (!match) return;

		var vote = parseFloat(match[0]);
		var color = "";

		if (vote >= 0 && vote <= 3) color = "red";
		else if (vote > 3 && vote < 6) color = "orange";
		else if (vote >= 6 && vote < 7) color = "cornflowerblue";
		else if (vote >= 7 && vote < 8) color = "darkmagenta";
		else if (vote >= 8 && vote <= 10) color = "lawngreen";

		if (color) {
			$el.css("color", color);
			if (labelElement) $(labelElement).css("color", color);
			if (Lampa.Storage.get("si_rating_border", false)) {
				if (
					$el.parent().hasClass("full-start__rate") ||
					$el.parent().hasClass("rate--kp") ||
					$el.parent().hasClass("rate--imdb") ||
					$el.parent().hasClass("rate--cub")
				) {
					$el.parent().css("border", "1px solid " + color);
				}
			}
		}
	}

	function showCubRating(render, e) {
		if (
			!e.object ||
			!e.object.source ||
			!(e.object.source === "cub" || e.object.source === "tmdb")
		)
			return;

		var rateCub = $(".rate--cub", render);
		if (rateCub.length === 0) {
			$(".rate--kp", render).after(
				'<div class="full-start__rate rate--cub hide"><div></div><div></div><div style="padding-left: 0;">CUB</div></div>'
			);
			rateCub = $(".rate--cub", render);
		}
		if (!rateCub.hasClass("hide")) return;

		var isTv = !!e.object.method && e.object.method === "tv";
		var card = e.data.movie;
		var cached = card && card.id ? getCache(card.id) : null;
		var reactions = null;

		if (cached && cached.cub && cached.cub.length) {
			reactions = cached.cub;
		} else if (
			e.data &&
			e.data.reactions &&
			e.data.reactions.result &&
			e.data.reactions.result.length
		) {
			reactions = e.data.reactions.result;
			if (card && card.id) saveCubCache(card.id, reactions);
		}

		if (!reactions || !reactions.length) return;

		var minCnt = 20;
		var reactionCoef = { fire: 10, nice: 7.5, think: 5, bore: 2.5, shit: 0 };
		var reactionCnt = {};
		var sum = 0,
			cnt = 0;

		for (var i = 0; i < reactions.length; i++) {
			var coef = reactionCoef[reactions[i].type];
			if (reactions[i].counter) {
				sum += reactions[i].counter * coef;
				cnt += reactions[i].counter * 1;
				reactionCnt[reactions[i].type] = reactions[i].counter * 1;
			}
		}

		if (cnt >= minCnt) {
			var avg_rating = isTv ? 7.436 : 6.584;
			var m = isTv ? 69 : 274;
			var cub_rating = (avg_rating * m + sum) / (m + cnt);
			var cub_rating_text = cub_rating.toFixed(1).replace("10.0", "10");

			var medianReaction = "",
				medianIndex = Math.floor(cnt / 2);
			var reaction = Object.entries(reactionCoef)
				.sort(function (a, b) {
					return a[1] - b[1];
				})
				.map(function (r) {
					return r[0];
				});
			var cumulativeCount = 0;
			while (reaction.length && cumulativeCount < medianIndex) {
				medianReaction = reaction.pop();
				cumulativeCount += reactionCnt[medianReaction] || 0;
			}

			var reactionSrc =
				Lampa.Utils.protocol() +
				Lampa.Manifest.cub_domain +
				"/img/reactions/" +
				medianReaction +
				".svg";
			var div = rateCub.removeClass("hide").find("> div");
			div.eq(0).text(cub_rating_text);
			div
				.eq(1)
				.html(
					'<img style="height:1.2em;margin:0 0.2em;" src="' + reactionSrc + '">'
				);
			applyRatingColor(div.eq(0), div.eq(2));
		}
	}

	function loadAndShowRating(card, render) {
		var cached = getCache(card.id);
		if (cached) {
			showRating(cached, render);
			return;
		}

		$(".info__rate", render).after(
			'<div style="width:2em;margin-top:1em;margin-right:1em" class="wait_rating"><div class="broadcast__scan"><div></div></div></div>'
		);

		fetchRating(card, function () {
			var data = getCache(card.id);
			if (data) showRating(data, render);
			else $(".wait_rating", render).remove();
		});
	}

	function startPlugin() {
		if (window.rating_plugin) return;
		window.rating_plugin = true;
		window.cub_rating_plugin = true;

		setupObserver();

		Lampa.Listener.follow("activity", function (e) {
			if (e.type === "active" || e.type === "start") {
				setTimeout(preloadVisibleCards, 500);
			}
		});

		Lampa.Listener.follow("full", function (e) {
			if (e.type === "complite") {
				var render = e.object.activity.render();
				var card = e.data.movie;
				loadAndShowRating(card, render);
				showCubRating(render, e);
			}
		});

		setTimeout(preloadVisibleCards, 800);
	}

	startPlugin();
})();
