(function () {
	"use strict";

	function injectStyles() {
		var style = document.createElement("style");
		style.textContent =
			".simple-keyboard-mic{pointer-events:none!important;color:#fff!important}.simple-keyboard-mic.focus{background:transparent!important;box-shadow:none!important;outline:none!important}";
		document.head.appendChild(style);
	}

	function disableMic() {
		var mic = document.querySelector(".simple-keyboard-mic");
		if (mic) {
			mic.classList.remove("selector");
			mic.removeAttribute("tabindex");
		}
	}

	function focusInput() {
		var input = document.querySelector(
			"#orsay-keyboard.simple-keyboard-input, .simple-keyboard-input"
		);
		if (input && document.activeElement !== input) {
			input.focus();
		}
	}

	function handleSearch() {
		setTimeout(function () {
			focusInput();
			disableMic();
		}, 100);
	}

	function start() {
		injectStyles();
		Lampa.Controller.listener.follow("toggle", function (e) {
			if (e.name === "search" || e.name === "keybord") {
				handleSearch();
			}
		});
	}

	if (window.appready) {
		start();
	} else if (typeof Lampa !== "undefined" && Lampa.Listener) {
		Lampa.Listener.follow("app", function (e) {
			if (e.type === "ready") start();
		});
	} else {
		setTimeout(start, 500);
	}
})();
