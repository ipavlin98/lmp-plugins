(function () {
	"use strict";
	var Subscribe = Lampa.Subscribe;

	function RuTube(call_video) {
		var stream_url;
		var object,
			video,
			listener,
			html_video,
			raw_video,
			first_play_event,
			last_video_width,
			last_video_height,
			ready_sent,
			activeNetwork,
			activeXhr;
		var outerDiv, layerDiv;

		outerDiv = document.createElement("div");
		outerDiv.className = "player-video__youtube";
		layerDiv = document.createElement("div");
		layerDiv.className = "player-video__youtube-layer";
		outerDiv.appendChild(layerDiv);
		object = $(outerDiv);
		video = object[0];
		listener = Subscribe();

		html_video = $(
			'<video style="width:100%;height:100%;position:absolute;top:0;left:0;" />'
		);
		raw_video = html_video[0];
		object.append(html_video);

		first_play_event = false;
		last_video_width = 0;
		last_video_height = 0;
		ready_sent = false;
		activeNetwork = null;
		activeXhr = null;

		Object.defineProperty(video, "src", {
			set: function (url) {
				stream_url = url;
			},
			get: function () {}
		});
		Object.defineProperty(video, "paused", {
			get: function () {
				return raw_video ? raw_video.paused : true;
			}
		});
		Object.defineProperty(video, "currentTime", {
			set: function (t) {
				try {
					if (raw_video) raw_video.currentTime = t;
				} catch (e) {}
			},
			get: function () {
				return raw_video ? raw_video.currentTime : 0;
			}
		});
		Object.defineProperty(video, "duration", {
			get: function () {
				return raw_video ? raw_video.duration || 0 : 0;
			}
		});

		Object.defineProperty(video, "videoWidth", {
			get: function () {
				return raw_video ? raw_video.videoWidth || 0 : 0;
			}
		});
		Object.defineProperty(video, "videoHeight", {
			get: function () {
				return raw_video ? raw_video.videoHeight || 0 : 0;
			}
		});

		video.addEventListener = listener.follow.bind(listener);

		function onReady() {
			if (ready_sent) return;
			ready_sent = true;
			listener.send("loadeddata");
			listener.send("canplay");
			listener.send("resize");
			var dur = raw_video ? raw_video.duration || 0 : 0;
			if (dur > 0) listener.send("durationchange", { duration: dur });
		}

		html_video.on("loadedmetadata", onReady);
		html_video.on("resize", function () {
			listener.send("resize");
		});

		html_video.on("canplay", function () {
			onReady();
			if (raw_video && raw_video.paused) {
				var p = raw_video.play();
				if (p && typeof p.catch === "function") p.catch(function () {});
			}
		});

		html_video.on("playing", function () {
			listener.send("playing");
			listener.send("play");
			listener.send("resize");
			if (typeof Lampa.PlayerPanel !== "undefined")
				Lampa.PlayerPanel.update("play");
		});

		html_video.on("pause", function () {
			listener.send("pause");
		});
		html_video.on("ended", function () {
			listener.send("ended");
		});

		html_video.on("timeupdate", function () {
			listener.send("timeupdate");
			if (!first_play_event && raw_video && raw_video.currentTime > 0.5) {
				first_play_event = true;
				listener.send("resize");
				var dur = raw_video.duration || 0;
				listener.send("durationchange", { duration: dur });
				listener.send("playing");
				listener.send("play");
			}
			var w = raw_video ? raw_video.videoWidth || 0 : 0;
			var h = raw_video ? raw_video.videoHeight || 0 : 0;
			if (
				w > 0 &&
				h > 0 &&
				(w !== last_video_width || h !== last_video_height)
			) {
				last_video_width = w;
				last_video_height = h;
				listener.send("resize");
			}
		});

		html_video.on("error", function () {
			var err = raw_video ? raw_video.error : null;
			var msg = err ? err.message || err.code : "Unknown";
			listener.send("error", { error: "Video Error: " + msg });
		});

		video.load = function () {
			var id;
			var m = stream_url.match(
				/^https?:\/\/(www\.)?rutube\.ru\/(play\/embed|video\/private|video|shorts)\/([\da-f]{32,})/i
			);
			if (m) id = m[3];

			if (!id) return Lampa.Noty.show("Rutube ID not found");

			var apiUrl =
				"https://rutube.ru/api/play/options/" +
				id +
				"/?format=json&no_404=true";
			var network = new Lampa.Reguest();
			activeNetwork = network;

			function parseM3U8AndGetBestQuality(masterUrl, callback) {
				var xhr = new XMLHttpRequest();
				var content,
					streams,
					baseUrl,
					lines,
					i,
					line,
					resMatch,
					bwMatch,
					nextLine,
					streamUrl,
					best;

				activeXhr = xhr;
				xhr.open("GET", masterUrl, true);
				xhr.onload = function () {
					if (xhr.status === 200) {
						content = xhr.responseText;
						streams = [];
						baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf("/") + 1);
						lines = content.split("\n");

						for (i = 0; i < lines.length; i++) {
							line = lines[i].trim();
							if (line.startsWith("#EXT-X-STREAM-INF:")) {
								resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
								bwMatch = line.match(/BANDWIDTH=(\d+)/);
								nextLine = lines[i + 1] ? lines[i + 1].trim() : "";
								if (nextLine && !nextLine.startsWith("#")) {
									streamUrl = nextLine;
									if (!streamUrl.startsWith("http")) {
										streamUrl = baseUrl + streamUrl;
									}
									streams.push({
										width: resMatch ? parseInt(resMatch[1], 10) : 0,
										height: resMatch ? parseInt(resMatch[2], 10) : 0,
										bandwidth: bwMatch ? parseInt(bwMatch[1], 10) : 0,
										url: streamUrl
									});
								}
							}
						}

						if (streams && streams.length > 0) {
							streams.sort(function (a, b) {
								return (b.height || b.bandwidth) - (a.height || a.bandwidth);
							});
							best = streams[0];
							callback(best.url, best.height);
						} else {
							callback(masterUrl, 0);
						}
					} else {
						callback(masterUrl, 0);
					}
				};
				xhr.onerror = function () {
					callback(masterUrl, 0);
				};
				xhr.send();
			}

			network.native(apiUrl, function (json) {
				if (json && json.video_balancer && json.video_balancer.m3u8) {
					parseM3U8AndGetBestQuality(
						json.video_balancer.m3u8,
						function (bestUrl, height) {
							html_video.attr("src", bestUrl);
							var levels = [
								{ title: "Auto", quality: "Auto", selected: false }
							];
							if (height > 0) {
								levels.push({
									title: height + "p",
									quality: height + "p",
									selected: true
								});
							}
							listener.send("levels", {
								levels: levels,
								current: height > 0 ? height + "p" : "Auto"
							});
						}
					);
				} else {
					Lampa.Noty.show("Rutube: video not available");
				}
			});
		};

		video.play = function () {
			if (raw_video) {
				var playPromise = raw_video.play();
				if (playPromise && typeof playPromise.catch === "function") {
					playPromise.catch(function () {});
				}
			}
		};
		video.pause = function () {
			if (raw_video) raw_video.pause();
		};
		video.destroy = function () {
			if (activeXhr) {
				try {
					activeXhr.abort();
				} catch (e) {}
				activeXhr = null;
			}
			if (activeNetwork) {
				try {
					activeNetwork.clear();
				} catch (e) {}
				activeNetwork = null;
			}
			html_video.remove();
			object.remove();
			listener.destroy();
		};

		call_video(video);
		return object;
	}
	Lampa.PlayerVideo.registerTube({
		name: "RuTube",
		verify: function (src) {
			return /^https?:\/\/(www\.)?rutube\.ru\/(play\/embed|video\/private|video|shorts)\/([\da-f]{32,})\/?(\?p=([^&]+))?/i.test(
				src
			);
		},
		create: RuTube
	});

	var proxy = "";
	var rootuTrailerApi = Lampa.Utils.protocol() + "trailer.rootu.top/search/";

	var SCORE = {
		EXACT_MATCH: 300,
		YEAR_MATCH: 100,
		WRONG_YEAR: -1000,
		NO_MATCH: -2000,
		WORD_MATCH: 100,
		EXTRA_WORD_PENALTY: 200,
		DURATION_BONUS: 50,
		DURATION_PENALTY: -50,
		MIN_RATE_THRESHOLD: 400
	};

	function cleanString(str) {
		return str
			.replace(/[^a-zA-Z\dа-яА-ЯёЁ]+/g, " ")
			.trim()
			.toLowerCase();
	}

	function cacheRequest(movie, isTv, success, fail) {
		var year = (movie.release_date || movie.first_air_date || "")
			.toString()
			.replace(/\D+/g, "")
			.substring(0, 4)
			.replace(/^([03-9]\d|1[0-8]|2[1-9]|20[3-9])\d+$/, "");
		var si;
		var search =
			movie.title ||
			movie.name ||
			movie.original_title ||
			movie.original_name ||
			"";
		var cleanSearch = cleanString(search);
		if (cleanSearch.length < 2) {
			return fail();
		}
		var searchOrig = movie.original_title || movie.original_name || "";
		var trailerTypes = ["трейлер", "trailer", "тизер"];
		var trailerIndex = 0;
		var tmdbId = movie.id ? "000000" + movie.id : "";
		if (tmdbId.length > 7)
			tmdbId = tmdbId.slice(-Math.max(7, (movie.id + "").length));
		var type = isTv ? "tv" : "movie";
		var rootuTrailersUrl = rootuTrailerApi + type + "/" + tmdbId + ".json";

		var id = type + (tmdbId || (Lampa.Utils.hash(search) * 1).toString(36));
		var key = "RUTUBE_trailer_" + id;
		var data = sessionStorage.getItem(key);

		if (data) {
			try {
				data = JSON.parse(data);
				if (data[0]) typeof success === "function" && success(data[1]);
				else typeof fail === "function" && fail(data[1]);
				return function () {};
			} catch (e) {
				sessionStorage.removeItem(key);
			}
		}

		function checkYearMatch(yearWords, year, cleanSearch) {
			var i, word;
			if (yearWords.indexOf(year) >= 0) return SCORE.YEAR_MATCH;
			for (i = 0; i < yearWords.length; i++) {
				word = yearWords[i];
				if (cleanSearch.indexOf(word) < 0) return SCORE.WRONG_YEAR;
			}
			return 0;
		}

		function calculateWordMatch(titleWords, queryWord) {
			var matchingWords, wordDiff, i;
			matchingWords = titleWords.filter(function (w) {
				return queryWord.indexOf(w) >= 0;
			});
			wordDiff = titleWords.length - matchingWords.length;
			return (
				matchingWords.length * SCORE.WORD_MATCH -
				wordDiff * SCORE.EXTRA_WORD_PENALTY
			);
		}

		function checkDuration(duration) {
			return duration > 120 ? SCORE.DURATION_BONUS : SCORE.DURATION_PENALTY;
		}

		function getRate(r, cleanSearch, year, queryWord) {
			var rate = 0;
			var titleWords, searchIndex, otherWords, yearWords, i;

			titleWords = r._title.split(" ");
			searchIndex = r._title.indexOf(cleanSearch);

			if (searchIndex >= 0) {
				rate += SCORE.EXACT_MATCH;

				if (year) {
					otherWords = r._title
						.substring(searchIndex + cleanSearch.length)
						.trim()
						.split(" ");
					if (
						otherWords.length &&
						otherWords[0] !== year &&
						/^(\d+|[ivx]+)$/.test(otherWords[0])
					) {
						rate += SCORE.WRONG_YEAR;
					}

					yearWords = titleWords.filter(function (w) {
						return (
							w.length === 4 && /^([03-9]\d|1[0-8]|2[1-9]|20[3-9])\d+$/.test(w)
						);
					});

					rate += checkYearMatch(yearWords, year, cleanSearch);
				}
			} else {
				rate = SCORE.NO_MATCH;
			}

			rate += calculateWordMatch(titleWords, queryWord);
			rate += checkDuration(r.duration);

			return rate;
		}

		var activeRequests = [];

		function cancelAllRequests() {
			var i;
			for (i = 0; i < activeRequests.length; i++) {
				try {
					if (activeRequests[i]) activeRequests[i].clear();
				} catch (e) {}
			}
			activeRequests = [];
		}

		function handleSearchFail(data) {
			sessionStorage.setItem(key, JSON.stringify([false, data || {}, search]));
			typeof fail === "function" && fail(data || {});
		}

		function handleSearchSuccess(results) {
			sessionStorage.setItem(key, JSON.stringify([true, results, search]));
			typeof success === "function" && success(results);
		}

		function processSearchResults(data, query) {
			var queryWord, origWords, i, results, simplifiedResults, postNetwork;

			queryWord = query.split(" ");
			if (searchOrig !== "" && search !== searchOrig) {
				origWords = cleanString(searchOrig).split(" ");
				for (i = 0; i < origWords.length; i++) {
					queryWord.push(origWords[i]);
				}
			}
			si += "=" + (Lampa.Utils.hash(si + id) * 1).toString(36);
			queryWord.push(
				isTv ? "сериал" : "фильм",
				"4k",
				"fullhd",
				"ultrahd",
				"ultra",
				"hd",
				"1080p"
			);

			results = data.results.filter(function (r) {
				var isTrailer, durationOk;
				r._title = cleanString(r.title);
				isTrailer =
					r._title.indexOf("трейлер") >= 0 ||
					r._title.indexOf("trailer") >= 0 ||
					r._title.indexOf("тизер") >= 0 ||
					r._title.indexOf("teaser") >= 0;
				durationOk = r.duration && r.duration < 600;
				if (
					!r.embed_url ||
					!isTrailer ||
					!durationOk ||
					r.is_hidden ||
					r.is_deleted ||
					r.is_locked ||
					r.is_audio ||
					r.is_paid ||
					r.is_livestream ||
					r.is_adult
				)
					return false;
				r._rate = getRate(r, cleanSearch, year, queryWord);
				return r._rate > SCORE.MIN_RATE_THRESHOLD;
			});

			if (results && results.length > 0) {
				results.sort(function (a, b) {
					return b._rate - a._rate;
				});
				handleSearchSuccess(results);

				if (tmdbId && /^\d+$/.test(tmdbId)) {
					simplifiedResults = results.map(function (r) {
						return {
							title: r.title,
							url: r.video_url || r.embed_url,
							thumbnail_url: r.thumbnail_url,
							duration: r.duration,
							author: r.author
						};
					});
					postNetwork = new Lampa.Reguest();
					activeRequests.push(postNetwork);
					postNetwork.quiet(
						rootuTrailersUrl + "?" + si,
						function () {
							postNetwork.clear();
						},
						function () {
							postNetwork.clear();
						},
						JSON.stringify(simplifiedResults)
					);
				}
			}
			return results;
		}

		function executeSearch(index) {
			var trailerType, query, rutubeApiUrl, network;

			if (index >= trailerTypes.length) {
				handleSearchFail({});
				return;
			}

			trailerType = trailerTypes[index];
			query = cleanString(
				[search, year, trailerType, isTv ? "сезон 1" : ""].join(" ")
			);
			rutubeApiUrl =
				"https://rutube.ru/api/search/video/" +
				"?query=" +
				encodeURIComponent(query) +
				"&format=json";
			si = Math.floor(new Date().getTime() / 1000).toString(36);
			network = new Lampa.Reguest();
			activeRequests.push(network);

			network.native(
				proxy + rutubeApiUrl,
				function (data) {
					var results;
					if (!data || !data.results || !data.results[0]) {
						network.clear();
						executeSearch(index + 1);
						return;
					}

					results = processSearchResults(data, query);
					if (!results || !results.length) {
						network.clear();
						executeSearch(index + 1);
						return;
					}

					network.clear();
				},
				function (data) {
					if (
						!proxy &&
						!window.AndroidJS &&
						!!data &&
						"status" in data &&
						"readyState" in data &&
						data.status === 0 &&
						data.readyState === 0
					) {
						proxy =
							Lampa.Storage.get("rutube_search_proxy", "") ||
							"https://rutube-search.root-1a7.workers.dev/";
						if (proxy.substr(-1) !== "/") proxy += "/";
						if (proxy !== "/") {
							network.clear();
							executeSearch(index);
							return;
						}
					}
					handleSearchFail(data);
					network.clear();
				}
			);
		}

		function fetchFromRutubeApi() {
			cancelAllRequests();
			executeSearch(0);
		}

		if (!tmdbId || /\D/.test(tmdbId)) {
			fetchFromRutubeApi();
			return function abort() {
				cancelAllRequests();
			};
		}

		var rootuTopNetwork = new Lampa.Reguest();
		activeRequests.push(rootuTopNetwork);
		rootuTopNetwork.timeout(2000);
		rootuTopNetwork.native(
			rootuTrailersUrl,
			function (rootuTrailerData) {
				if (rootuTrailerData && rootuTrailerData.length) {
					sessionStorage.setItem(
						key,
						JSON.stringify([true, rootuTrailerData, search])
					);
					typeof success === "function" && success(rootuTrailerData);
				} else {
					fetchFromRutubeApi();
				}
				rootuTopNetwork.clear();
				rootuTopNetwork = null;
			},
			function (xhr) {
				fetchFromRutubeApi();
				rootuTopNetwork.clear();
				rootuTopNetwork = null;
			}
		);

		return function abort() {
			cancelAllRequests();
		};
	}

	var loadTrailersActiveRequests = [];

	function cancelLoadTrailers() {
		var i;
		for (i = 0; i < loadTrailersActiveRequests.length; i++) {
			try {
				if (loadTrailersActiveRequests[i]) loadTrailersActiveRequests[i]();
			} catch (e) {}
		}
		loadTrailersActiveRequests = [];
	}

	function loadTrailers(event, success, fail) {
		var movie, isTv, title, searchOk, abortFn;

		if (
			!event.object ||
			!event.object.source ||
			!event.data ||
			!event.data.movie
		)
			return;

		cancelLoadTrailers();

		movie = event.data.movie;
		isTv =
			!!event.object && !!event.object.method && event.object.method === "tv";
		title =
			movie.title ||
			movie.name ||
			movie.original_title ||
			movie.original_name ||
			"";
		if (title === "") return;

		searchOk = function (data) {
			if (data && data[0]) {
				success(data);
			} else {
				fail();
			}
		};

		abortFn = cacheRequest(movie, isTv, searchOk, fail);
		if (typeof abortFn === "function") {
			loadTrailersActiveRequests.push(abortFn);
		}
	}

	Lampa.Player.listener.follow("destroy", function () {
		cancelLoadTrailers();
	});

	Lampa.Lang.add({
		rutube_trailer_trailer: {
			be: "Трэйлер",
			bg: "Трейлър",
			cs: "Trailer",
			en: "Trailer",
			he: "טריילר",
			pt: "Trailer",
			ru: "Трейлер",
			uk: "Трейлер",
			zh: "预告片"
		},
		rutube_trailer_trailers: {
			be: "Трэйлеры",
			bg: "Трейлъри",
			cs: "Trailery",
			en: "Trailers",
			he: "טריילרים",
			pt: "Trailers",
			ru: "Трейлеры",
			uk: "Трейлери",
			zh: "预告片"
		},
		rutube_trailer_preview: {
			be: "Перадпрагляд",
			bg: "Преглед",
			cs: "Náhled",
			en: "Preview",
			he: "תצוגה מקדימה",
			pt: "Pré-visualização",
			ru: "Превью",
			uk: "Попередній перегляд",
			zh: "预览"
		},
		rutube_trailer_rutube: {
			be: "Знойдзена на RUTUBE",
			bg: "Намерено в RUTUBE",
			cs: "Nalezeno na RUTUBE",
			en: "Found on RUTUBE",
			he: "נמצא ב-RUTUBE",
			pt: "Encontrado no RUTUBE",
			ru: "Найдено на RUTUBE",
			uk: "Знайдено на RUTUBE",
			zh: "在 RUTUBE 上找到"
		},
		rutube_trailers_title: {
			be: "RUTUBE: трэйлеры",
			bg: "RUTUBE: трейлъри",
			cs: "RUTUBE: trailery",
			en: "RUTUBE: trailers",
			he: "RUTUBE: טריילרים",
			pt: "RUTUBE: trailers",
			ru: "RUTUBE: трейлеры",
			uk: "RUTUBE: трейлери",
			zh: "RUTUBE：预告片"
		},
		rutube_trailer_404: {
			be: "Трэйлер не знойдзены.",
			bg: "Трейлърът не е намерен.",
			cs: "Trailer nebyl nalezen.",
			en: "Trailer not found.",
			he: "הטריילר לא נמצא.",
			pt: "Trailer não encontrado.",
			ru: "Трейлер не найден.",
			uk: "Трейлер не знайдено.",
			zh: "未找到预告片。"
		},
		rutube_trailer_wait: {
			be: "Пачакайце, яшчэ шукаем трэйлер...",
			bg: "Изчакайте, все още търсим трейлър...",
			cs: "Počkejte, stále hledáme trailer...",
			en: "Please wait, still looking for a trailer...",
			he: "אנא המתן, עדיין מחפשים טריילר...",
			pt: "Aguarde, ainda estamos procurando um trailer...",
			ru: "Подождите, ещё ищем трейлер...",
			uk: "Зачекайте, ще шукаємо трейлер...",
			zh: "请稍候，仍在寻找预告片……"
		}
	});

	function startPlugin() {
		window.rutube_trailer_plugin = true;

		Lampa.SettingsApi.addParam({
			component: "more",
			param: {
				name: "rutube_trailers",
				type: "trigger",
				default: true
			},
			field: {
				name: Lampa.Lang.translate("rutube_trailers_title")
			}
		});
		var button =
			'<div class="full-start__button selector view--rutube_trailer" data-subtitle="#{rutube_trailer_rutube}">' +
			'<svg width="134" height="134" viewBox="0 0 134 134" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M81.5361 62.9865H42.5386V47.5547H81.5361C83.814 47.5547 85.3979 47.9518 86.1928 48.6451C86.9877 49.3385 87.4801 50.6245 87.4801 52.5031V58.0441C87.4801 60.0234 86.9877 61.3094 86.1928 62.0028C85.3979 62.6961 83.814 62.9925 81.5361 62.9925V62.9865ZM84.2115 33.0059H26V99H42.5386V77.5294H73.0177L87.4801 99H106L90.0546 77.4287C95.9333 76.5575 98.573 74.7559 100.75 71.7869C102.927 68.8179 104.019 64.071 104.019 57.7359V52.7876C104.019 49.0303 103.621 46.0613 102.927 43.7857C102.233 41.51 101.047 39.5307 99.362 37.7528C97.5824 36.0698 95.6011 34.8845 93.2223 34.0904C90.8435 33.3971 87.8716 33 84.2115 33V33.0059Z" fill="currentColor"/><path d="M198 3.05176e-05C198 36.4508 168.451 66.0001 132 66.0001C124.589 66.0001 117.464 64.7786 110.814 62.5261C110.956 60.9577 111.019 59.3541 111.019 57.7359V52.7876C111.019 48.586 110.58 44.8824 109.623 41.7436C108.59 38.3588 106.82 35.4458 104.443 32.938L104.311 32.7988L104.172 32.667C101.64 30.2721 98.7694 28.5625 95.4389 27.4506L95.3108 27.4079L95.1812 27.3701C92.0109 26.446 88.3508 26 84.2115 26H77.2115V26.0059H71.3211C67.8964 18.0257 66 9.23434 66 3.05176e-05C66 -36.4508 95.5492 -66 132 -66C168.451 -66 198 -36.4508 198 3.05176e-05Z" fill="currentColor"/><rect x="1" y="1" width="130" height="130" stroke="currentColor" stroke-width="2"/></svg>' +
			"<span>#{rutube_trailer_trailers}</span>" +
			"</div>";

		Lampa.Listener.follow("full", function (event) {
			if (event.type === "complite" && Lampa.Storage.field("rutube_trailers")) {
				var render = event.object.activity.render();
				var trailerBtn = render.find(".view--trailer");
				var btn = $(Lampa.Lang.translate(button));
				if (trailerBtn.length) {
					trailerBtn.before(btn);
					trailerBtn.toggleClass("hide", !window.YT);
				} else {
					render.find(".full-start__button:last").after(btn);
				}
				var onEnter = function () {
					Lampa.Noty.show(Lampa.Lang.translate("rutube_trailer_wait"));
				};
				btn.on("hover:enter", function () {
					onEnter();
				});
				loadTrailers(
					event,
					function (data) {
						var playlist = [];
						data.forEach(function (res) {
							playlist.push({
								title: Lampa.Utils.shortText(res.title, 50),
								subtitle: Lampa.Utils.shortText(res.author.name, 30),
								url: res.video_url || res.embed_url || res.url,
								iptv: true,
								icon:
									'<img class="size-youtube" src="' +
									res.thumbnail_url +
									'" />',
								template: "selectbox_icon"
							});
						});
						onEnter = function () {
							Lampa.Select.show({
								title: Lampa.Lang.translate("rutube_trailers_title"),
								items: playlist,
								onSelect: function (a) {
									Lampa.Player.play(a);
									Lampa.Player.playlist(playlist);
								},
								onBack: function () {
									Lampa.Controller.toggle("full_start");
								}
							});
						};
						btn.removeClass("hide");
					},
					function () {
						btn.addClass("hide");
						onEnter = function () {
							Lampa.Noty.show(Lampa.Lang.translate("rutube_trailer_404"));
						};
					}
				);
			}
		});
	}
	if (!window.rutube_trailer_plugin) startPlugin();
})();
