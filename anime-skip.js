(function () {
	"use strict";

	const ANISKIP_API = "https://api.aniskip.com/v2/skip-times";
	const JIKAN_API = "https://api.jikan.moe/v4/anime";
	const SKIP_TYPES = ["op", "ed", "recap"];

	function updatePlaylist(playlist, currentSeason, currentEpisode, segments) {
		if (playlist && Array.isArray(playlist)) {
			playlist.forEach((item, index) => {
				const itemSeason = item.season || item.s || currentSeason;
				const itemEpisode =
					item.episode || item.e || item.episode_number || index + 1;

				if (
					parseInt(itemEpisode) === parseInt(currentEpisode) &&
					parseInt(itemSeason) === parseInt(currentSeason)
				) {
					item.segments = item.segments || {};
					item.segments.skip = segments.slice();
				}
			});
		}
	}

	async function searchAndApply(videoParams) {
		let card = videoParams.movie || videoParams.card;
		if (!card) {
			const active = Lampa.Activity.active();
			if (active) card = active.movie || active.card;
		}
		if (!card) return;

		const title = videoParams.title || card.title || card.name || "";
		const trailerKeywords = ["трейлер", "trailer", "тизер", "teaser"];
		const isTrailerTitle = trailerKeywords.some((k) =>
			title.toLowerCase().includes(k)
		);

		if (isTrailerTitle) {
			return;
		}

		const kpId =
			card.kinopoisk_id ||
			(card.source === "kinopoisk" ? card.id : null) ||
			card.kp_id;

		const position = (function (params, defaultSeason = 1) {
			if (params.episode || params.e || params.episode_number) {
				return {
					season: parseInt(params.season || params.s || defaultSeason),
					episode: parseInt(params.episode || params.e || params.episode_number)
				};
			}
			if (params.playlist && Array.isArray(params.playlist)) {
				const url = params.url;
				const index = params.playlist.findIndex((p) => p.url && p.url === url);
				if (index !== -1) {
					const item = params.playlist[index];
					return {
						season: parseInt(item.season || item.s || defaultSeason),
						episode: index + 1
					};
				}
			}
			return { season: defaultSeason, episode: 1 };
		})(videoParams, 1);

		let episode = position.episode;
		let season = position.season;

		const isSerial =
			card.number_of_seasons > 0 ||
			(card.original_name && !card.original_title);
		if (!isSerial) {
			season = 1;
			episode = 1;
		}

		const lang = (card.original_language || "").toLowerCase();
		const isAsian = lang === "ja" || lang === "zh" || lang === "cn";
		const isAnimation =
			card.genres &&
			card.genres.some(
				(g) => g.id === 16 || (g.name && g.name.toLowerCase() === "animation")
			);

		if (isAsian || isAnimation) {
			let cleanName = card.original_name || card.original_title || card.name;
			const searchTerm = cleanName
				? cleanName
						.replace(/\(\d{4}\)/g, "")
						.replace(/\(TV\)/gi, "")
						.replace(/Season \d+/gi, "")
						.replace(/Part \d+/gi, "")
						.replace(/[:\-]/g, " ")
						.replace(/\s+/g, " ")
						.trim()
				: "";

			const releaseYear = (
				card.release_date ||
				card.first_air_date ||
				"0000"
			).slice(0, 4);

			const malId = await (async function (title, seas, year) {
				let query = title;
				if (seas > 1) query += " Season " + seas;

				const url = `${JIKAN_API}?q=${encodeURIComponent(query)}&limit=10`;

				try {
					const response = await fetch(url);
					const json = await response.json();

					if (!json.data || json.data.length === 0) return null;

					if (year && seas === 1) {
						const match = json.data.find((item) => {
							let y = item.year;
							if (!y && item.aired && item.aired.from)
								y = item.aired.from.substring(0, 4);
							return String(y) === String(year);
						});
						if (match) {
							return match.mal_id;
						}
					}

					if (seas > 1) {
						const ordinal =
							seas +
							(seas % 10 === 1 && seas !== 11
								? "st"
								: seas % 10 === 2 && seas !== 12
									? "nd"
									: seas % 10 === 3 && seas !== 13
										? "rd"
										: "th");
						const keywords = [
							`Season ${seas}`,
							`${ordinal} Season`,
							`Season${seas}`
						];

						const titleMatch = json.data.find((item) => {
							const titlesToCheck = [
								item.title,
								item.title_english,
								...(item.title_synonyms || [])
							]
								.filter(Boolean)
								.map((t) => t.toLowerCase());

							return titlesToCheck.some((t) =>
								keywords.some((k) => t.includes(k.toLowerCase()))
							);
						});

						if (titleMatch) {
							return titleMatch.mal_id;
						}
					}

					return json.data[0].mal_id;
				} catch (e) {
					return null;
				}
			})(searchTerm, season, releaseYear);

			if (malId) {
				const segmentsData = await (async function (id, ep) {
					const types = SKIP_TYPES.map((t) => "types=" + t);
					types.push("episodeLength=0");
					const url = `${ANISKIP_API}/${id}/${ep}?${types.join("&")}`;

					try {
						const res = await fetch(url);
						if (res.status === 404) return [];
						const data = await res.json();
						if (data.found && data.results && data.results.length > 0) {
							return data.results;
						}
						return [];
					} catch (e) {
						return [];
					}
				})(malId, episode);

				const finalSegments = (function (rawSegments) {
					if (!rawSegments || !rawSegments.length) return [];
					const list = [];
					rawSegments.forEach((s) => {
						if (!s.interval) return;
						const type = (s.skipType || s.skip_type || "").toLowerCase();
						let name = "Пропустить";
						if (type.includes("op")) name = "Опенинг";
						else if (type.includes("ed")) name = "Эндинг";
						else if (type === "recap") name = "Рекап";

						const start =
							s.interval.startTime !== undefined
								? s.interval.startTime
								: s.interval.start_time;
						const end =
							s.interval.endTime !== undefined
								? s.interval.endTime
								: s.interval.end_time;

						if (start !== undefined && end !== undefined) {
							list.push({ start, end, name });
						}
					});
					return list;
				})(segmentsData);

				if (finalSegments.length > 0) {
					videoParams.segments = videoParams.segments || {};
					videoParams.segments.skip = finalSegments.slice();

					updatePlaylist(videoParams.playlist, season, episode, finalSegments);
					Lampa.Noty.show(
						"Таймкоды загружены: Сезон " + season + ", Серия " + episode
					);
				}
			}
		}
	}

	function init() {
		if (window.lampa_ultimate_skip) return;
		window.lampa_ultimate_skip = true;

		const originalPlay = Lampa.Player.play;
		const originalPlaylist = Lampa.Player.playlist;
		let pendingPlaylist = null;

		Lampa.Player.playlist = function (playlist) {
			pendingPlaylist = playlist;
			originalPlaylist.call(this, playlist);
		};

		Lampa.Player.play = function (videoParams) {
			const context = this;

			if (videoParams.url) {
				Lampa.PlayerPlaylist.url(videoParams.url);
			}

			if (videoParams.playlist && videoParams.playlist.length > 0) {
				Lampa.PlayerPlaylist.set(videoParams.playlist);
			}

			searchAndApply(videoParams)
				.then(() => {
					originalPlay.call(context, videoParams);

					if (pendingPlaylist) {
						Lampa.PlayerPlaylist.set(pendingPlaylist);
						pendingPlaylist = null;
					}
				})
				.catch((e) => {
					originalPlay.call(context, videoParams);
				});
		};
	}

	if (window.Lampa && window.Lampa.Player) {
		init();
	} else {
		window.document.addEventListener("app_ready", init);
	}
})();
