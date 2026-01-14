(function () {
	"use strict";

	var pipActive = false;
	var pipContainer = null;
	var originalVideoParent = null;
	var originalVideo = null;
	var originalPlayerVideoDestroy = null;
	var originalPlayerClose = null;
	var originalPlayerPlay = null;
	var isEnteringPiP = false;
	var isExitingPiP = false;
	var pipActivatedTime = 0;
	var savedPlayData = null;
	var playerContainer = null;
	var savedPanelState = null;
	var capturedEvents = {};
	var pipTimelineInterval = null;
	var savedTimelineHash = null;
	var savedSegments = null;

	function savePanelState() {
		savedPanelState = { buttons: {} };

		var panel = document.querySelector(".player-panel");
		if (panel) {
			var leftPrev = panel.querySelector(
				".player-panel__left .player-panel__prev"
			);
			var leftNext = panel.querySelector(
				".player-panel__left .player-panel__next"
			);
			var centerPrev = panel.querySelector(
				".player-panel__center .player-panel__prev"
			);
			var centerNext = panel.querySelector(
				".player-panel__center .player-panel__next"
			);

			if (leftPrev)
				savedPanelState.buttons["left-prev"] =
					!leftPrev.classList.contains("hide");
			if (leftNext)
				savedPanelState.buttons["left-next"] =
					!leftNext.classList.contains("hide");
			if (centerPrev)
				savedPanelState.buttons["center-prev"] =
					!centerPrev.classList.contains("hide");
			if (centerNext)
				savedPanelState.buttons["center-next"] =
					!centerNext.classList.contains("hide");
		}

		if (savedPlayData && savedPlayData.segments) {
			savedSegments = JSON.parse(JSON.stringify(savedPlayData.segments));
		} else {
			savedSegments = null;
		}
	}

	function restorePanelState() {
		if (!savedPanelState) return;

		var panel = document.querySelector(".player-panel");
		if (panel && savedPanelState.buttons) {
			var leftPrev = panel.querySelector(
				".player-panel__left .player-panel__prev"
			);
			var leftNext = panel.querySelector(
				".player-panel__left .player-panel__next"
			);
			var centerPrev = panel.querySelector(
				".player-panel__center .player-panel__prev"
			);
			var centerNext = panel.querySelector(
				".player-panel__center .player-panel__next"
			);

			if (leftPrev && savedPanelState.buttons["left-prev"] !== undefined) {
				leftPrev.classList.toggle(
					"hide",
					!savedPanelState.buttons["left-prev"]
				);
			}
			if (leftNext && savedPanelState.buttons["left-next"] !== undefined) {
				leftNext.classList.toggle(
					"hide",
					!savedPanelState.buttons["left-next"]
				);
			}
			if (centerPrev && savedPanelState.buttons["center-prev"] !== undefined) {
				centerPrev.classList.toggle(
					"hide",
					!savedPanelState.buttons["center-prev"]
				);
			}
			if (centerNext && savedPanelState.buttons["center-next"] !== undefined) {
				centerNext.classList.toggle(
					"hide",
					!savedPanelState.buttons["center-next"]
				);
			}
		}

		var playlist = Lampa.PlayerPlaylist.get();
		var position = Lampa.PlayerPlaylist.position();
		if (playlist && playlist.length > 0) {
			Lampa.PlayerPlaylist.set(playlist);
			Lampa.PlayerPanel.showNextEpisodeName({
				playlist: playlist,
				position: position
			});
		}

		if (capturedEvents.tracks) {
			Lampa.PlayerPanel.setTracks(capturedEvents.tracks);
		}
		if (capturedEvents.subs) {
			Lampa.PlayerPanel.setSubs(capturedEvents.subs);
		}
		if (capturedEvents.levels) {
			Lampa.PlayerPanel.setLevels(
				capturedEvents.levels.levels,
				capturedEvents.levels.current
			);
		}
		if (capturedEvents.quality) {
			Lampa.PlayerPanel.quality(
				capturedEvents.quality.qs,
				capturedEvents.quality.url
			);
		}
		if (capturedEvents.flows && Lampa.PlayerPanel.setFlows) {
			Lampa.PlayerPanel.setFlows(capturedEvents.flows);
		}
		if (capturedEvents.translate) {
			Lampa.PlayerPanel.setTranslate(capturedEvents.translate);
		}

		if (savedSegments) {
			if (Lampa.Player && Lampa.Player.listener) {
				Lampa.Player.listener.send("segments", savedSegments);
			}

			setTimeout(function () {
				var segmentsContainer = document.querySelector(
					".player-panel__timeline-segments"
				);

				if (segmentsContainer && Lampa.PlayerVideo && Lampa.PlayerVideo.video) {
					var video = Lampa.PlayerVideo.video();
					var duration = video ? video.duration : 0;

					segmentsContainer.innerHTML = "";

					if (duration && savedSegments) {
						for (var name in savedSegments) {
							if (!Array.isArray(savedSegments[name])) continue;
							for (var a = 0; a < savedSegments[name].length; a++) {
								var seg = savedSegments[name][a];

								var segElem = document.createElement("div");
								segElem.className =
									"player-panel__timeline-segment player-panel__timeline-segment--" +
									name;
								var rStart = Math.min(duration, seg.start);
								var rEnd = Math.min(duration, seg.end);
								var start = (rStart / duration) * 100;
								var length = ((rEnd - rStart) / duration) * 100;

								segElem.style.left = start + "%";
								segElem.style.width = length + "%";
								segmentsContainer.appendChild(segElem);
							}
						}
					}
				}
			}, 200);
		}
	}

	var postPipTimelineInterval = null;
	var postPipTimelineHash = null;

	function saveTimelineDirectly(hash, time, duration, percent) {
		var timeline = Lampa.Storage.get("timeline", "[]");
		var found = false;

		for (var i = 0; i < timeline.length; i++) {
			if (timeline[i].hash === hash) {
				timeline[i].time = time;
				timeline[i].duration = duration;
				timeline[i].percent = percent;
				found = true;
				break;
			}
		}

		if (!found) {
			timeline.push({
				hash: hash,
				time: time,
				duration: duration,
				percent: percent,
				profile: 0
			});
		}

		Lampa.Storage.set("timeline", timeline);
	}

	function startPostPipTimelineUpdate(hash) {
		stopPostPipTimelineUpdate();
		postPipTimelineHash = hash;
		postPipTimelineInterval = setInterval(function () {
			var video =
				Lampa.PlayerVideo && Lampa.PlayerVideo.video
					? Lampa.PlayerVideo.video()
					: null;
			if (video && !video.paused && video.duration && postPipTimelineHash) {
				var currentTime = video.currentTime;
				var duration = video.duration;
				var percent = Math.round((currentTime / duration) * 100);

				if (
					savedPlayData &&
					savedPlayData.timeline &&
					savedPlayData.timeline.handler
				) {
					savedPlayData.timeline.time = currentTime;
					savedPlayData.timeline.duration = duration;
					savedPlayData.timeline.percent = percent;
					savedPlayData.timeline.handler(percent, currentTime, duration);
				} else {
					saveTimelineDirectly(
						postPipTimelineHash,
						currentTime,
						duration,
						percent
					);
				}
			} else if (
				!video ||
				!document.body.classList.contains("player--viewing")
			) {
				if (postPipTimelineHash) {
					var lastVideo =
						Lampa.PlayerVideo && Lampa.PlayerVideo.video
							? Lampa.PlayerVideo.video()
							: null;
					if (lastVideo && lastVideo.duration) {
						var currentTime = lastVideo.currentTime;
						var duration = lastVideo.duration;
						var percent = Math.round((currentTime / duration) * 100);

						if (
							savedPlayData &&
							savedPlayData.timeline &&
							savedPlayData.timeline.handler
						) {
							savedPlayData.timeline.time = currentTime;
							savedPlayData.timeline.duration = duration;
							savedPlayData.timeline.percent = percent;
							savedPlayData.timeline.handler(percent, currentTime, duration);
						} else {
							saveTimelineDirectly(
								postPipTimelineHash,
								currentTime,
								duration,
								percent
							);
						}
					}
				}

				clearInterval(postPipTimelineInterval);
				postPipTimelineInterval = null;
				postPipTimelineHash = null;
			}
		}, 3000);
	}

	function stopPostPipTimelineUpdate() {
		if (postPipTimelineInterval) {
			var video =
				Lampa.PlayerVideo && Lampa.PlayerVideo.video
					? Lampa.PlayerVideo.video()
					: null;
			if (video && video.duration && postPipTimelineHash) {
				var currentTime = video.currentTime;
				var duration = video.duration;
				var percent = Math.round((currentTime / duration) * 100);

				if (
					savedPlayData &&
					savedPlayData.timeline &&
					savedPlayData.timeline.handler
				) {
					savedPlayData.timeline.time = currentTime;
					savedPlayData.timeline.duration = duration;
					savedPlayData.timeline.percent = percent;
					savedPlayData.timeline.handler(percent, currentTime, duration);
				} else {
					Lampa.Timeline.update({
						hash: postPipTimelineHash,
						time: currentTime,
						duration: duration,
						percent: percent
					});
				}
			}
			clearInterval(postPipTimelineInterval);
			postPipTimelineInterval = null;
			postPipTimelineHash = null;
		}
		savedPlayData = null;
	}

	function startPipTimelineUpdate() {
		stopPipTimelineUpdate();
		pipTimelineInterval = setInterval(function () {
			if (
				pipActive &&
				originalVideo &&
				!originalVideo.paused &&
				originalVideo.duration &&
				savedTimelineHash
			) {
				var currentTime = originalVideo.currentTime;
				var duration = originalVideo.duration;
				var percent = Math.round((currentTime / duration) * 100);

				if (
					savedPlayData &&
					savedPlayData.timeline &&
					savedPlayData.timeline.handler
				) {
					savedPlayData.timeline.time = currentTime;
					savedPlayData.timeline.duration = duration;
					savedPlayData.timeline.percent = percent;
					savedPlayData.timeline.handler(percent, currentTime, duration);
				} else {
					Lampa.Timeline.update({
						hash: savedTimelineHash,
						time: currentTime,
						duration: duration,
						percent: percent
					});
				}
			}
		}, 3000);
	}

	function stopPipTimelineUpdate() {
		if (pipTimelineInterval) {
			clearInterval(pipTimelineInterval);
			pipTimelineInterval = null;
		}
	}

	function setupEventCapture() {
		if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
			Lampa.PlayerVideo.listener.follow("tracks", function (e) {
				capturedEvents.tracks = e.tracks;
			});
			Lampa.PlayerVideo.listener.follow("subs", function (e) {
				capturedEvents.subs = e.subs;
			});
			Lampa.PlayerVideo.listener.follow("levels", function (e) {
				capturedEvents.levels = { levels: e.levels, current: e.current };
			});
		}
	}

	function interceptPanelMethods() {
		if (Lampa.PlayerPanel) {
			var origSetTracks = Lampa.PlayerPanel.setTracks;
			if (origSetTracks && !origSetTracks._intercepted) {
				Lampa.PlayerPanel.setTracks = function (tr) {
					capturedEvents.tracks = tr;
					return origSetTracks.apply(this, arguments);
				};
				Lampa.PlayerPanel.setTracks._intercepted = true;
			}

			var origSetSubs = Lampa.PlayerPanel.setSubs;
			if (origSetSubs && !origSetSubs._intercepted) {
				Lampa.PlayerPanel.setSubs = function (su) {
					capturedEvents.subs = su;
					return origSetSubs.apply(this, arguments);
				};
				Lampa.PlayerPanel.setSubs._intercepted = true;
			}

			var origSetLevels = Lampa.PlayerPanel.setLevels;
			if (origSetLevels && !origSetLevels._intercepted) {
				Lampa.PlayerPanel.setLevels = function (levels, current) {
					capturedEvents.levels = { levels: levels, current: current };
					return origSetLevels.apply(this, arguments);
				};
				Lampa.PlayerPanel.setLevels._intercepted = true;
			}

			var origQuality = Lampa.PlayerPanel.quality;
			if (origQuality && !origQuality._intercepted) {
				Lampa.PlayerPanel.quality = function (qs, url) {
					if (qs) capturedEvents.quality = { qs: qs, url: url };
					return origQuality.apply(this, arguments);
				};
				Lampa.PlayerPanel.quality._intercepted = true;
			}

			var origSetFlows = Lampa.PlayerPanel.setFlows;
			if (origSetFlows && !origSetFlows._intercepted) {
				Lampa.PlayerPanel.setFlows = function (data) {
					capturedEvents.flows = data;
					return origSetFlows.apply(this, arguments);
				};
				Lampa.PlayerPanel.setFlows._intercepted = true;
			}

			var origSetTranslate = Lampa.PlayerPanel.setTranslate;
			if (origSetTranslate && !origSetTranslate._intercepted) {
				Lampa.PlayerPanel.setTranslate = function (data) {
					capturedEvents.translate = data;
					return origSetTranslate.apply(this, arguments);
				};
				Lampa.PlayerPanel.setTranslate._intercepted = true;
			}
		}
	}

	function createPipContainer() {
		if (pipContainer) return;

		pipContainer = document.createElement("div");
		pipContainer.id = "lampa-pip-container";
		pipContainer.innerHTML = '<div class="lampa-pip-video-wrap"></div>';
		document.body.appendChild(pipContainer);

		pipContainer.addEventListener("click", function (e) {
			if (Date.now() - pipActivatedTime < 500) return;
			if (
				e.target === pipContainer ||
				e.target.classList.contains("lampa-pip-video-wrap")
			) {
				exitPiP();
			}
		});
	}

	function createHeaderButton() {
		var existing = document.querySelector(".head__action.pip--icon");
		if (existing) return;

		var actions = document.querySelector(".head__actions");
		if (!actions) return;

		var btn = document.createElement("div");
		btn.className = "head__action selector pip--icon";
		btn.style.display = "none";
		btn.innerHTML =
			'<svg viewBox="0 0 24.5 23.2" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19.1,0h-3.7h-1.5H5.3C2.4,0,0,2.4,0,5.4v12.5c0,3,2.4,5.3,5.4,5.3h13.8c3,0,5.3-2.4,5.3-5.3V9.9V8.5V5.4C24.5,2.4,22.1,0,19.1,0z M19.1,20.5h-13H5.3c-1.5,0-2.6-1.2-2.6-2.7V5.4c0-1.5,1.2-2.6,2.6-2.6h5.1c-0.1,0.2-0.1,0.5-0.1,0.7v6.5c0,1.9,1.5,3.4,3.4,3.4H21c0.3,0,0.5,0,0.7-0.1v4.5C21.8,19.3,20.6,20.5,19.1,20.5z M21.8,9.9c0,0.4-0.3,0.7-0.7,0.7h-7.2c-0.4,0-0.7-0.3-0.7-0.7V3.4c0-0.4,0.3-0.7,0.7-0.7h1.5h3.7c1.5,0,2.7,1.2,2.7,2.6v3.2V9.9z" fill="currentColor"/></svg>';

		actions.insertBefore(btn, actions.firstChild);

		btn.addEventListener("click", function (e) {
			e.stopPropagation();
			exitPiP();
		});

		$(btn).on("hover:enter", function () {
			exitPiP();
		});
	}

	function showHeaderButton() {
		var btn = document.querySelector(".head__action.pip--icon");
		if (btn) btn.style.display = "";
	}

	function hideHeaderButton() {
		var btn = document.querySelector(".head__action.pip--icon");
		if (btn) btn.style.display = "none";
	}

	function togglePiP() {
		if (pipActive) {
			exitPiP();
		} else {
			enterPiP();
		}
	}

	function updatePipSize() {
		if (!pipContainer || !originalVideo) return;

		var videoWidth = originalVideo.videoWidth || 16;
		var videoHeight = originalVideo.videoHeight || 9;
		var aspectRatio = videoWidth / videoHeight;

		var pipWidth = 512;
		var pipHeight = Math.round(pipWidth / aspectRatio);

		pipContainer.style.width = pipWidth + "px";
		pipContainer.style.height = pipHeight + "px";
	}

	function enterPiP() {
		if (isEnteringPiP) {
			return;
		}

		originalVideo = document.querySelector(".player-video__display video");
		if (!originalVideo) {
			originalVideo = document.querySelector(".player video");
		}

		if (!originalVideo) {
			Lampa.Noty.show(
				"PiP доступен только со встроенным плеером. Измените плеер в настройках."
			);
			return;
		}

		isEnteringPiP = true;
		originalVideoParent = originalVideo.parentElement;
		playerContainer = document.querySelector(".player");

		savedPlayData = Lampa.Player.playdata();

		if (savedPlayData && savedPlayData.timeline) {
			savedTimelineHash = savedPlayData.timeline.hash;
		}

		savePanelState();

		createPipContainer();

		var videoWrap = pipContainer.querySelector(".lampa-pip-video-wrap");
		videoWrap.appendChild(originalVideo);

		originalVideo.style.cssText =
			"width:100%!important;height:100%!important;object-fit:contain!important;position:static!important;transform:none!important;";

		updatePipSize();
		originalVideo.addEventListener("loadedmetadata", updatePipSize);

		pipActive = true;
		pipActivatedTime = Date.now();
		pipContainer.classList.add("active");

		document.body.classList.add("lampa-pip-mode");
		document.body.classList.remove("player--viewing");

		Lampa.PlayerPanel.hide();

		createHeaderButton();
		showHeaderButton();

		startPipTimelineUpdate();

		setTimeout(function () {
			Lampa.Controller.toggle("content");
			isEnteringPiP = false;
		}, 50);
	}

	function exitPiP() {
		if (!pipActive) return;

		isExitingPiP = true;

		stopPipTimelineUpdate();

		var timelineHashForRestore = savedTimelineHash;

		if (originalVideo && originalVideo.duration && savedTimelineHash) {
			var currentTime = originalVideo.currentTime;
			var duration = originalVideo.duration;
			var percent = Math.round((currentTime / duration) * 100);

			Lampa.Timeline.update({
				hash: savedTimelineHash,
				time: currentTime,
				duration: duration,
				percent: percent
			});

			if (savedPlayData && savedPlayData.timeline) {
				savedPlayData.timeline.time = currentTime;
				savedPlayData.timeline.duration = duration;
				savedPlayData.timeline.percent = percent;
			}
		}

		if (originalVideo) {
			originalVideo.removeEventListener("loadedmetadata", updatePipSize);
		}

		if (pipContainer) {
			pipContainer.classList.remove("active");
		}

		if (playerContainer && !playerContainer.isConnected) {
			document.body.appendChild(playerContainer);
		}

		if (originalVideo && originalVideoParent) {
			originalVideoParent.appendChild(originalVideo);
			originalVideo.style.cssText = "";
		}

		document.body.classList.remove("lampa-pip-mode");
		document.body.classList.add("player--viewing");
		hideHeaderButton();

		pipActive = false;

		Lampa.Controller.toggle("player");
		Lampa.PlayerPanel.show(true);

		restorePanelState();

		startPostPipTimelineUpdate(timelineHashForRestore);

		originalVideo = null;
		originalVideoParent = null;
		playerContainer = null;
		isExitingPiP = false;
	}

	function closePiPCompletely() {
		stopPipTimelineUpdate();

		if (originalVideo && originalVideo.duration && savedTimelineHash) {
			var currentTime = originalVideo.currentTime;
			var duration = originalVideo.duration;
			var percent = Math.round((currentTime / duration) * 100);

			Lampa.Timeline.update({
				hash: savedTimelineHash,
				time: currentTime,
				duration: duration,
				percent: percent
			});
		}

		if (originalVideo && originalVideoParent) {
			if (playerContainer && !playerContainer.isConnected) {
				document.body.appendChild(playerContainer);
			}
			originalVideoParent.appendChild(originalVideo);
			originalVideo.style.cssText = "";
		}

		pipActive = false;
		isEnteringPiP = false;
		isExitingPiP = false;

		if (pipContainer) {
			pipContainer.classList.remove("active");
		}

		document.body.classList.remove("lampa-pip-mode");
		hideHeaderButton();

		savedPlayData = null;
		savedPanelState = null;
		savedTimelineHash = null;
		savedSegments = null;
		capturedEvents = {};
		originalVideo = null;
		originalVideoParent = null;
		playerContainer = null;
	}

	function addStyles() {
		var css = [
			"#lampa-pip-container {",
			"  display: none;",
			"  position: fixed;",
			"  width: 400px;",
			"  height: 225px;",
			"  right: 30px;",
			"  bottom: 30px;",
			"  z-index: 999999;",
			"  border-radius: 10px;",
			"  overflow: hidden;",
			"  box-shadow: 0 5px 30px rgba(0,0,0,0.7);",
			"  background: #000;",
			"  cursor: pointer;",
			"  transition: width 0.2s, height 0.2s;",
			"  -webkit-transform: translateZ(0);",
			"  transform: translateZ(0);",
			"  -webkit-mask-image: -webkit-radial-gradient(white, black);",
			"}",
			"#lampa-pip-container.active {",
			"  display: block;",
			"}",
			".lampa-pip-video-wrap {",
			"  width: 100%;",
			"  height: 100%;",
			"  overflow: hidden;",
			"  border-radius: 10px;",
			"  -webkit-transform: translateZ(0);",
			"  transform: translateZ(0);",
			"  -webkit-mask-image: -webkit-radial-gradient(white, black);",
			"}",
			".lampa-pip-video-wrap video {",
			"  width: 100% !important;",
			"  height: 100% !important;",
			"  object-fit: contain !important;",
			"  transform: none !important;",
			"  border-radius: 10px;",
			"}",
			"body.lampa-pip-mode .player {",
			"  position: fixed !important;",
			"  width: 1px !important;",
			"  height: 1px !important;",
			"  left: -9999px !important;",
			"  top: -9999px !important;",
			"  overflow: hidden !important;",
			"  pointer-events: none !important;",
			"}",
			"body.lampa-pip-mode .activity--active {",
			"  opacity: 1 !important;",
			"}",
			".player-panel__pip.hide {",
			"  display: flex !important;",
			"}"
		].join("\n");

		var style = document.createElement("style");
		style.id = "lampa-pip-styles";
		style.textContent = css;
		document.head.appendChild(style);
	}

	function overridePipHandler() {
		if (
			Lampa.PlayerPanel &&
			Lampa.PlayerPanel.listener &&
			Lampa.PlayerPanel.listener._listeners
		) {
			Lampa.PlayerPanel.listener._listeners["pip"] = [togglePiP];
		}
	}

	function showPipButton() {
		var pipBtn = document.querySelector(".player-panel__pip");
		if (pipBtn) {
			pipBtn.classList.remove("hide");
		}
	}

	function interceptPlayerMethods() {
		if (
			!originalPlayerVideoDestroy &&
			Lampa.PlayerVideo &&
			Lampa.PlayerVideo.destroy
		) {
			originalPlayerVideoDestroy = Lampa.PlayerVideo.destroy;
			Lampa.PlayerVideo.destroy = function (savemeta) {
				if (pipActive) {
					return;
				}

				if (postPipTimelineHash) {
					var video =
						Lampa.PlayerVideo && Lampa.PlayerVideo.video
							? Lampa.PlayerVideo.video()
							: null;

					if (video && video.duration) {
						var currentTime = video.currentTime;
						var duration = video.duration;
						var percent = Math.round((currentTime / duration) * 100);

						Lampa.Timeline.update({
							hash: postPipTimelineHash,
							time: currentTime,
							duration: duration,
							percent: percent
						});
					}

					stopPostPipTimelineUpdate();
				}

				return originalPlayerVideoDestroy.call(this, savemeta);
			};
		}

		if (!originalPlayerClose && Lampa.Player && Lampa.Player.close) {
			originalPlayerClose = Lampa.Player.close;
			Lampa.Player.close = function () {
				if (pipActive || isEnteringPiP) {
					return;
				}
				return originalPlayerClose.call(this);
			};
		}

		if (!originalPlayerPlay && Lampa.Player && Lampa.Player.play) {
			originalPlayerPlay = Lampa.Player.play;
			Lampa.Player.play = function (data) {
				if (data && data.timeline) {
					var stored = Lampa.Storage.get("timeline", "[]");
					var found = stored.find(function (t) {
						return t.hash === data.timeline.hash;
					});

					if (found && found.time > data.timeline.time) {
						data.timeline.time = found.time;
						data.timeline.duration = found.duration;
						data.timeline.percent = found.percent;
					}
				}

				if (pipActive && !isExitingPiP) {
					Lampa.Noty.show("Сначала закройте PiP");
					return;
				}
				return originalPlayerPlay.call(this, data);
			};
		}

		if (Lampa.Player && Lampa.Player.iptv) {
			var originalPlayerIptv = Lampa.Player.iptv;
			if (!originalPlayerIptv._pipIntercepted) {
				Lampa.Player.iptv = function (data) {
					if (pipActive && !isExitingPiP) {
						Lampa.Noty.show("Сначала закройте PiP");
						return;
					}
					return originalPlayerIptv.call(this, data);
				};
				Lampa.Player.iptv._pipIntercepted = true;
			}
		}
	}

	function initPlugin() {
		addStyles();
		overridePipHandler();
		interceptPlayerMethods();
		interceptPanelMethods();
		setupEventCapture();

		Lampa.Listener.follow("player", function (e) {
			if (e.type === "start") {
				stopPostPipTimelineUpdate();
				setTimeout(function () {
					overridePipHandler();
					interceptPlayerMethods();
					interceptPanelMethods();
					showPipButton();
				}, 100);
			}

			if (
				e.type === "destroy" ||
				e.type === "close" ||
				e.type === "end" ||
				e.type === "stop"
			) {
				if (pipActive) {
					closePiPCompletely();
				}
			}
		});
	}

	if (window.appready) {
		initPlugin();
	} else {
		Lampa.Listener.follow("app", function (e) {
			if (e.type === "ready") {
				initPlugin();
			}
		});
	}
})();
