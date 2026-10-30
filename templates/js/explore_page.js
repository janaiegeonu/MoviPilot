/* =========================================================
   MOVIPILOT EXPLORE PAGE — INTERACTIONS (v2)
   Backend endpoints, media payload keys, and existing DOM IDs are preserved.
   ========================================================= */

(() => {
    "use strict";

    document.addEventListener("DOMContentLoaded", () => {
        const page = document.querySelector(".explore-page");
        if (!page) return;

        const mediaType = String(page.dataset.mediaType || "").trim().toLowerCase();
const mediaID = Number(page.dataset.mediaId);
const loggedIn = page.dataset.loggedIn === "true";
        const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const coarsePointer = window.matchMedia("(hover: none), (pointer: coarse)").matches;

        const toast = document.getElementById("exploreToast");
        let toastTimer = null;

        /* ---------------------------------------------------------
           Shared helpers: toast, auth gate, JSON requests, escaping
           --------------------------------------------------------- */
        function showToast(message) {
            if (!toast) return;
            toast.textContent = message;
            toast.classList.add("is-visible");
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3200);
        }

        if (!["movie", "tv"].includes(mediaType) || !Number.isSafeInteger(mediaID) || mediaID <= 0) {
    console.error("[MOVIPILOT EXPLORE] Invalid page identity", {
        mediaType,
        mediaID,
        url: window.location.href
    });
    showToast("This title link is missing a valid movie or series type. Please return and open it again.");
    return;
}

        function requireLogin(message = "Please log in to use this MoviPilot feature.") {
            if (loggedIn) return true;
            showToast(message);
            return false;
        }

        async function requestJSON(url, options = {}) {
            const response = await fetch(url, {
                credentials: "same-origin",
                ...options,
                headers: {
                    Accept: "application/json",
                    ...(options.body ? { "Content-Type": "application/json" } : {}),
                    ...(options.headers || {})
                }
            });

            let payload = {};
            try {
                payload = await response.json();
            } catch (_) {
                payload = {};
            }

            if (!response.ok) {
                const error = new Error(payload.error || `Request failed (${response.status})`);
                error.status = response.status;
                throw error;
            }
            return payload;
        }

        function mediaPayload(extra = {}) {
            return { media_type: mediaType, media_id: mediaID, ...extra };
        }

        function escapeHTML(value) {
            return String(value)
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")
                .replaceAll(">", "&gt;")
                .replaceAll('"', "&quot;")
                .replaceAll("'", "&#039;");
        }

        function createSparkBurst(container, options = {}) {
            if (!container || prefersReducedMotion) return;
            const count = options.count || 16;
            const className = options.className || "like-spark";
            const area = options.area || container;

            for (let index = 0; index < count; index += 1) {
                const spark = document.createElement("span");
                spark.className = className;
                spark.setAttribute("aria-hidden", "true");
                const angle = (Math.PI * 2 * index) / count + Math.random() * 0.3;
                const distance = 20 + Math.random() * 46;
                spark.style.setProperty("--spark-x", `${Math.cos(angle) * distance}px`);
                spark.style.setProperty("--spark-y", `${Math.sin(angle) * distance - 9}px`);
                spark.style.setProperty("--spark-size", `${className === "like-spark" ? 3 + Math.random() * 4 : 2 + Math.random() * 3}px`);
                if (className === "like-spark") {
                    spark.style.setProperty("--spark-left", `${38 + Math.random() * 25}%`);
                    spark.style.setProperty("--spark-top", `${31 + Math.random() * 32}%`);
                }
                area.appendChild(spark);
                spark.addEventListener("animationend", () => spark.remove(), { once: true });
                setTimeout(() => spark.remove(), 1450);
            }
        }

        /* Light tactile feedback only; the CSS supplies the liquid-glass finish. */
        function addPressFeedback(element) {
            if (!element) return;
            element.classList.add("is-pressing");
            window.setTimeout(() => element.classList.remove("is-pressing"), 190);
        }

        /* Keep pointer interactions calm: no cursor-following flash or 3D card tilt. */
        document.querySelectorAll(".explore-action-button, .community-like-button, .review-submit-button, .create-collection-button").forEach((button) => {
            button.addEventListener("pointerdown", () => addPressFeedback(button));
        });

       /* ---------------------------------------------------------
   EXPLORE BACK NAVIGATION

   Returns users to the page they opened Explore from.

   Priority:
   1. Use the browser's actual previous history entry.
   2. Use the saved return URL if browser history fails.
   3. Do not force users back to the dashboard.
   --------------------------------------------------------- */

(() => {
    const backButton = document.getElementById("exploreBack");

    if (!backButton) {
        return;
    }

    // Prevent duplicate event listeners if this script
    // happens to be initialized more than once.
    if (backButton.dataset.backNavigationBound === "true") {
        return;
    }

    backButton.dataset.backNavigationBound = "true";

    const RETURN_KEY = "movipilot:explore:return:v1";
    const MAX_RETURN_AGE = 2 * 60 * 60 * 1000; // 2 hours

    let isNavigatingBack = false;

    const buttonLabel = backButton.querySelector("span");
    const originalLabel = buttonLabel?.textContent || "Back";


    /* -----------------------------------------------------
       Validate a previous URL.

       Only same-origin MoviPilot URLs are accepted.
       ----------------------------------------------------- */

    function getSafeSameOriginURL(value) {
        if (!value) {
            return null;
        }

        try {
            const url = new URL(value, window.location.origin);

            if (url.origin !== window.location.origin) {
                return null;
            }

            if (url.href === window.location.href) {
                return null;
            }

            return url.href;

        } catch (error) {
            return null;
        }
    }


    /* -----------------------------------------------------
       Retrieve the saved page from sessionStorage.
       ----------------------------------------------------- */

    function getSavedReturnURL() {
        try {
            const savedData = sessionStorage.getItem(RETURN_KEY);

            if (!savedData) {
                return null;
            }

            const parsedData = JSON.parse(savedData);

            const savedAt = Number(parsedData.savedAt);

            // Reject expired or invalid saved destinations.
            if (
                !savedAt ||
                Date.now() - savedAt > MAX_RETURN_AGE
            ) {
                sessionStorage.removeItem(RETURN_KEY);
                return null;
            }

            return getSafeSameOriginURL(parsedData.url);

        } catch (error) {
            console.warn(
                "[MoviPilot] Could not retrieve saved return page:",
                error
            );

            return null;
        }
    }


    /* -----------------------------------------------------
       Determine the best fallback destination.

       The saved URL is preferred because it preserves
       the exact page and URL the user came from.
       ----------------------------------------------------- */

    function getPreviousPageURL() {
        const savedURL = getSavedReturnURL();

        if (savedURL) {
            return savedURL;
        }

        return getSafeSameOriginURL(document.referrer);
    }


    /* -----------------------------------------------------
       Clear the stored destination after using it.
       ----------------------------------------------------- */

    function clearSavedReturnURL() {
        try {
            sessionStorage.removeItem(RETURN_KEY);
        } catch (error) {
            console.warn(
                "[MoviPilot] Could not clear saved return page:",
                error
            );
        }
    }


    /* -----------------------------------------------------
       Handle cases where no previous page is available.
       ----------------------------------------------------- */

    function restoreBackButton() {
        isNavigatingBack = false;

        backButton.disabled = false;
        backButton.removeAttribute("aria-busy");

        if (buttonLabel) {
            buttonLabel.textContent = "No previous page";

            window.setTimeout(() => {
                buttonLabel.textContent = originalLabel;
            }, 2200);
        }

        console.warn(
            "[MoviPilot] No previous page is available for navigation."
        );
    }


    /* -----------------------------------------------------
       Navigate to the saved page if browser history fails.

       replace() prevents the Explore page from remaining
       immediately behind the restored page in history.
       ----------------------------------------------------- */

    function useFallbackDestination(previousPageURL) {
        if (previousPageURL) {
            window.location.replace(previousPageURL);
            return;
        }

        restoreBackButton();
    }


    /* -----------------------------------------------------
       Back button click handler.
       ----------------------------------------------------- */

    backButton.addEventListener("click", (event) => {
        event.preventDefault();

        // Ignore additional clicks while navigation is pending.
        if (isNavigatingBack) {
            return;
        }

        isNavigatingBack = true;

        backButton.disabled = true;
        backButton.setAttribute("aria-busy", "true");

        if (buttonLabel) {
            buttonLabel.textContent = "Going back...";
        }

        const previousPageURL = getPreviousPageURL();
        const currentURL = window.location.href;

        // Save the fallback URL locally before clearing storage.
        clearSavedReturnURL();


        /* -------------------------------------------------
           FIRST CHOICE: Browser history navigation.
           ------------------------------------------------- */

        if (window.history.length > 1) {

            let navigationStarted = false;

            // Detect whether the browser actually started
            // navigating to the previous history entry.
            const markNavigationStarted = () => {
                navigationStarted = true;
            };

            window.addEventListener(
                "pagehide",
                markNavigationStarted,
                { once: true }
            );

            window.addEventListener(
                "popstate",
                markNavigationStarted,
                { once: true }
            );

            window.history.back();


            /* ---------------------------------------------
               FALLBACK

               If the history movement does not happen,
               return to the exact saved previous page.
               --------------------------------------------- */

            window.setTimeout(() => {

                const urlHasChanged =
                    window.location.href !== currentURL;

                if (navigationStarted || urlHasChanged) {
                    return;
                }

                useFallbackDestination(previousPageURL);

            }, 1500);

            return;
        }


        /* -------------------------------------------------
           SECOND CHOICE: Saved previous page.

           This handles cases where Explore was opened
           without a usable browser history entry.
           ------------------------------------------------- */

        useFallbackDestination(previousPageURL);

    });
})();

        /* ---------------------------------------------------------
           Watchlist toggle
           --------------------------------------------------------- */
        const watchlistButton = document.getElementById("watchlistButton");
        const watchlistButtonLabel = document.getElementById("watchlistButtonLabel");

        watchlistButton?.addEventListener("click", async (event) => {
            if (!requireLogin()) return;
            addPressFeedback(watchlistButton, event);
            watchlistButton.disabled = true;
            try {
                const result = await requestJSON("/api/explore/watchlist", {
                    method: "POST",
                    body: JSON.stringify(mediaPayload())
                });
                const active = result.watchlisted === true;
                watchlistButton.classList.toggle("is-active", active);
                watchlistButton.setAttribute("aria-pressed", String(active));
                if (watchlistButtonLabel) {
                    watchlistButtonLabel.textContent = active ? "Remove from Watchlist" : "Add to Watchlist";
                }
                if (active) createSparkBurst(watchlistButton, { count: 9, className: "rating-spark" });
                showToast(active ? "Added to your Watchlist." : "Removed from your Watchlist.");
            } catch (error) {
                if (error.status === 401) requireLogin();
                else showToast(error.message || "Could not update Watchlist.");
            } finally {
                watchlistButton.disabled = false;
            }
        });
        if (watchlistButton) watchlistButton.setAttribute("aria-pressed", String(watchlistButton.classList.contains("is-active")));

        /* ---------------------------------------------------------
           Trailer / video modal
           --------------------------------------------------------- */
        const videoModal = document.getElementById("videoModal");
        const videoFrame = document.getElementById("videoFrame");
        const videoModalTitle = document.getElementById("videoModalTitle");
        const videoModalClose = document.getElementById("videoModalClose");
        const videoModalBackdrop = document.getElementById("videoModalBackdrop");
        let lastVideoTrigger = null;

        function openVideo(key, title, trigger) {
            if (!videoModal || !videoFrame || !key) {
                showToast("This video is not available to play.");
                return;
            }
            lastVideoTrigger = trigger || document.activeElement;
            videoFrame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&rel=0&modestbranding=1`;
            if (videoModalTitle) videoModalTitle.textContent = title || "MoviPilot video";
            videoModal.hidden = false;
            document.body.style.overflow = "hidden";
            videoModalClose?.focus();
        }

        function closeVideo() {
            if (!videoModal || !videoFrame || videoModal.hidden) return;
            videoFrame.src = "";
            videoModal.hidden = true;
            document.body.style.overflow = "";
            if (lastVideoTrigger && typeof lastVideoTrigger.focus === "function") lastVideoTrigger.focus();
        }

        document.getElementById("heroTrailerButton")?.addEventListener("click", (event) => {
            openVideo(event.currentTarget.dataset.videoKey, event.currentTarget.dataset.videoTitle, event.currentTarget);
        });

        document.querySelectorAll(".video-thumb-button").forEach((button) => {
            button.addEventListener("click", () => openVideo(button.dataset.videoKey, button.dataset.videoTitle, button));
        });
        videoModalClose?.addEventListener("click", closeVideo);
        videoModalBackdrop?.addEventListener("click", closeVideo);

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && videoModal && !videoModal.hidden) closeVideo();
            if (event.key === "Escape" && collectionPanel && !collectionPanel.hidden) closeCollectionPanel();
            if (event.key === "Escape" && keywordResultsPanel && !keywordResultsPanel.hidden) {
                keywordResultsPanel.hidden = true;
            }
        });

        /* ---------------------------------------------------------
           Rating gate: live preview separate from saved rating, plus glow sparks
           --------------------------------------------------------- */
        const ratingRoot = document.getElementById("starRating");
        const ratingStars = Array.from(document.querySelectorAll(".rating-star"));
        const ratingMessage = document.getElementById("userRatingMessage");
        const unlockRatingButton = document.getElementById("unlockRatingButton");
        let savedUserRating = ratingStars.filter((star) => star.classList.contains("is-filled")).length;

        function showRatingPreview(rating) {
            ratingStars.forEach((star) => {
                star.classList.toggle("is-previewed", Number(star.dataset.rating) <= rating);
            });
        }

        function clearRatingPreview() {
            ratingStars.forEach((star) => star.classList.remove("is-previewed"));
        }

        function applyRating(rating) {
            const safeRating = Math.max(0, Math.min(5, Number(rating) || 0));
            ratingStars.forEach((star) => {
                const selected = Number(star.dataset.rating) <= safeRating;
                star.classList.toggle("is-filled", selected);
                star.setAttribute("aria-checked", String(Number(star.dataset.rating) === safeRating));
            });
            savedUserRating = safeRating;
            clearRatingPreview();
            if (ratingMessage) ratingMessage.textContent = safeRating ? `You rated this ${safeRating}/5` : "How would you rate it?";
        }

        function setRatingUnlocked() {
            if (!ratingRoot) return;
            ratingRoot.dataset.enabled = "true";
            ratingRoot.setAttribute("aria-disabled", "false");
            ratingStars.forEach((star) => { star.disabled = false; });
            if (ratingMessage && savedUserRating === 0) ratingMessage.textContent = "How would you rate it?";
            unlockRatingButton?.remove();
        }

        ratingStars.forEach((star) => {
            star.setAttribute("aria-checked", String(Number(star.dataset.rating) === savedUserRating));
            star.addEventListener("mouseenter", () => {
                if (!star.disabled) showRatingPreview(Number(star.dataset.rating));
            });
            star.addEventListener("focus", () => {
                if (!star.disabled) showRatingPreview(Number(star.dataset.rating));
            });
            star.addEventListener("keydown", (event) => {
                if (star.disabled || !["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const current = Number(star.dataset.rating);
                const nextRating = event.key === "Home" ? 1 : event.key === "End" ? 5 : Math.max(1, Math.min(5, current + (event.key === "ArrowRight" ? 1 : -1)));
                ratingStars[nextRating - 1]?.focus();
            });
            star.addEventListener("click", async () => {
                if (star.disabled) {
                    showToast(loggedIn
                        ? "Watch this title from a MoviPilot recommendation first to unlock ratings."
                        : "Please log in and watch this title from a recommendation to rate it.");
                    return;
                }
                if (!requireLogin()) return;

                const rating = Number(star.dataset.rating);
                star.classList.add("is-submitting");
                try {
                    await requestJSON("/api/explore/rating", {
                        method: "POST",
                        body: JSON.stringify(mediaPayload({ rating }))
                    });
                    applyRating(rating);
                    createSparkBurst(star, { count: 80, className: "rating-spark", area: star });
                    showToast("Your MoviPilot rating was saved.");
                } catch (error) {
                    showToast(error.message || "Could not save rating.");
                } finally {
                    star.classList.remove("is-submitting");
                }
            });
        });

        ratingRoot?.addEventListener("mouseleave", clearRatingPreview);
        ratingRoot?.addEventListener("focusout", (event) => {
            if (!ratingRoot.contains(event.relatedTarget)) clearRatingPreview();
        });

        unlockRatingButton?.addEventListener("click", async () => {
            if (!requireLogin()) return;
            unlockRatingButton.disabled = true;
            try {
                await requestJSON("/api/explore/watch-event", {
                    method: "POST",
                    body: JSON.stringify(mediaPayload({ source: "recommendation" }))
                });
                setRatingUnlocked();
                showToast("Watched status recorded. Your 5-star rating is unlocked.");
            } catch (error) {
                showToast(error.message || "Could not record watched status.");
                unlockRatingButton.disabled = false;
            }
        });

        /* ---------------------------------------------------------
           Collection picker: delegated clicks avoid duplicate bindings
           --------------------------------------------------------- */
        const collectionPanel = document.getElementById("collectionPanel");
        const collectionButton = document.getElementById("collectionButton");
        const collectionPanelClose = document.getElementById("collectionPanelClose");
        const createCollectionForm = document.getElementById("createCollectionForm");
        const newCollectionName = document.getElementById("newCollectionName");
        const collectionList = document.getElementById("collectionList");

        function collectionChoiceHTML(collection) {
            const count = Number(collection.item_count ?? collection.ItemCount ?? 0);
            const id = Number(collection.id ?? collection.ID ?? 0);
            const name = collection.name || collection.Name || "Collection";
            return `
                <button class="collection-choice" type="button" data-collection-id="${id}">
                    <span class="collection-choice-icon">
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path d="M5 7.5C5 6.67 5.67 6 6.5 6H10L12 8H17.5C18.33 8 19 8.67 19 9.5V17.5C19 18.33 18.33 19 17.5 19H6.5C5.67 19 5 18.33 5 17.5V7.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                        </svg>
                    </span>
                    <span><strong>${escapeHTML(name)}</strong><small>${count} ${count === 1 ? "item" : "items"}</small></span>
                </button>`;
        }

        async function loadCollections() {
            if (!loggedIn || !collectionList) return;
            collectionList.setAttribute("aria-busy", "true");
            try {
                const result = await requestJSON("/api/explore/collections");
                const collections = Array.isArray(result.collections) ? result.collections : [];
                if (!collections.length) {
                    collectionList.innerHTML = '<div class="collection-empty">No collections yet. Create your first one using the form beside this list.</div>';
                } else {
                    collectionList.innerHTML = collections.map(collectionChoiceHTML).join("");
                }
            } catch (error) {
                showToast(error.message || "Could not load collections.");
            } finally {
                collectionList.removeAttribute("aria-busy");
            }
        }

        function openCollectionPanel() {
            if (!requireLogin()) return;
            if (!collectionPanel) return;
            collectionPanel.hidden = false;
            collectionButton?.setAttribute("aria-expanded", "true");
            collectionPanel.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
            loadCollections();
            window.setTimeout(() => newCollectionName?.focus({ preventScroll: true }), 170);
        }

        function closeCollectionPanel() {
            if (!collectionPanel) return;
            collectionPanel.hidden = true;
            collectionButton?.setAttribute("aria-expanded", "false");
            collectionButton?.focus({ preventScroll: true });
        }

        async function addToCollection(collectionID) {
            try {
                await requestJSON("/api/explore/collection-items", {
                    method: "POST",
                    body: JSON.stringify({ collection_id: Number(collectionID), media_type: mediaType, media_id: mediaID })
                });
                showToast("Added to your collection.");
                return true;
            } catch (error) {
                showToast(error.message || "Could not add title to collection.");
                return false;
            }
        }

        collectionButton?.setAttribute("aria-expanded", "false");
        collectionButton?.addEventListener("click", openCollectionPanel);
        collectionPanelClose?.addEventListener("click", closeCollectionPanel);

        collectionList?.addEventListener("click", async (event) => {
            const choice = event.target.closest(".collection-choice");
            if (!choice || !collectionList.contains(choice)) return;
            const collectionID = Number(choice.dataset.collectionId);
            if (!collectionID) return;
            choice.disabled = true;
            choice.classList.add("is-adding");
            const wasAdded = await addToCollection(collectionID);
            if (wasAdded) closeCollectionPanel();
            else choice.disabled = false;
            choice.classList.remove("is-adding");
        });

        createCollectionForm?.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (!requireLogin()) return;
            const name = newCollectionName?.value.trim() || "";
            if (!name) {
                showToast("Enter a collection name first.");
                newCollectionName?.focus();
                return;
            }

            const submitButton = createCollectionForm.querySelector("button[type='submit']");
            if (submitButton) submitButton.disabled = true;
            try {
                const result = await requestJSON("/api/explore/collections", {
                    method: "POST",
                    body: JSON.stringify({ name })
                });
                const collection = result.collection;
                const collectionID = Number(collection?.id ?? collection?.ID ?? 0);
                if (!collectionID) throw new Error("Collection was not created.");

                const added = await addToCollection(collectionID);
                newCollectionName.value = "";
                await loadCollections();
                if (added) {
                    showToast(`“${name}” created and title added.`);
                    createSparkBurst(submitButton, { count: 10, className: "rating-spark", area: submitButton });
                }
            } catch (error) {
                showToast(error.message || "Could not create collection.");
            } finally {
                if (submitButton) submitButton.disabled = false;
            }
        });

        /* ---------------------------------------------------------
           Like animation + community reaction count
           --------------------------------------------------------- */
        const likeButton = document.getElementById("likeButton");
        const likeButtonLabel = document.getElementById("likeButtonLabel");
        const communityLikeCount = document.getElementById("communityLikeCount");
        const communityHeartState = document.getElementById("communityHeartState");
        const likeCard = document.getElementById("likeCard");
        const likeCardCopy = likeCard?.querySelector("p");
        const defaultLikeCopy = likeCardCopy?.textContent || "Your like contributes to the global MoviPilot pulse for everyone.";

        function updateLikeVisualState(liked) {
            likeButton?.classList.toggle("is-liked", liked);
            likeCard?.classList.toggle("is-liked", liked);
            likeButton?.setAttribute("aria-pressed", String(liked));
            if (likeButtonLabel) likeButtonLabel.textContent = liked ? "You liked this" : "Like this title";
            if (likeCardCopy) {
                likeCardCopy.textContent = liked
                    ? "You are part of the MoviPilot pulse. Your reaction helps other viewers discover what matters."
                    : defaultLikeCopy;
            }
            if (communityHeartState) communityHeartState.textContent = liked ? "♥" : "♥";
        }

        updateLikeVisualState(likeButton?.classList.contains("is-liked") === true);

        likeButton?.addEventListener("click", async (event) => {
            if (!requireLogin()) return;
            addPressFeedback(likeButton, event);
            likeButton.disabled = true;
            try {
                const result = await requestJSON("/api/explore/like", {
                    method: "POST",
                    body: JSON.stringify(mediaPayload())
                });
                const liked = result.liked === true;
                updateLikeVisualState(liked);
                if (communityLikeCount && Number.isFinite(Number(result.like_count))) {
                    communityLikeCount.textContent = Number(result.like_count).toLocaleString();
                }
                if (liked) {
                    likeButton.classList.remove("is-celebrating");
                    void likeButton.offsetWidth;
                    likeButton.classList.add("is-celebrating");
                    createSparkBurst(likeCard || likeButton, { count: 80, className: "like-spark", area: likeCard || likeButton });
                    setTimeout(() => likeButton.classList.remove("is-celebrating"), 420);
                    showToast("You liked this title. The community pulse just grew.");
                } else {
                    showToast("Like removed.");
                }
            } catch (error) {
                showToast(error.message || "Could not update like.");
            } finally {
                likeButton.disabled = false;
            }
        });

        /* ---------------------------------------------------------
           Global reviews: character count, auto-height and media-feed rendering
           --------------------------------------------------------- */
        const reviewInput = document.getElementById("reviewInput");
        const reviewSubmit = document.getElementById("reviewSubmit");
        const reviewStatus = document.getElementById("reviewStatus");
        const reviewsFeed = document.getElementById("reviewsFeed");
        const reviewCharacterCount = document.getElementById("reviewCharacterCount");
        const reviewComposerField = document.querySelector(".review-composer-field");

        function updateReviewComposer() {
            if (!reviewInput) return;
            const length = reviewInput.value.length;
            if (reviewCharacterCount) {
                reviewCharacterCount.textContent = `${length.toLocaleString()} / 2,000`;
                reviewCharacterCount.classList.toggle("is-near-limit", length >= 1800);
            }
            reviewComposerField?.classList.toggle("has-content", length > 0);
            reviewSubmit?.classList.toggle("has-draft", length > 0);
            reviewInput.style.height = "auto";
            reviewInput.style.height = `${Math.min(reviewInput.scrollHeight, 280)}px`;
        }
        reviewInput?.addEventListener("input", updateReviewComposer);
        updateReviewComposer();

        function renderReviews(reviews) {
            if (!reviewsFeed) return;
            if (!Array.isArray(reviews) || !reviews.length) {
                reviewsFeed.innerHTML = `
                    <div class="review-empty">
                        <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
                            <path d="M14 18C14 14.69 16.69 12 20 12H44C47.31 12 50 14.69 50 18V35C50 38.31 47.31 41 44 41H31L22 50V41H20C16.69 41 14 38.31 14 35V18Z" stroke="currentColor" stroke-width="1.6"/>
                            <path d="M23 25H41M23 31H36" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                        <strong>No reviews yet</strong>
                        <span>Start the conversation. Be the first MoviPilot viewer to share a take.</span>
                    </div>`;
                return;
            }

            reviewsFeed.innerHTML = reviews.map((review, index) => {
                const author = review.author_name || review.AuthorName || "MoviPilot User";
                const created = review.created_at || review.CreatedAt || "";
                const body = review.review || review.Review || "";
                return `
                    <article class="review-item" style="animation-delay:${Math.min(index * 45, 225)}ms">
                        <div class="review-avatar" aria-hidden="true">${escapeHTML(author.trim().slice(0, 1) || "M")}</div>
                        <div class="review-body">
                            <div class="review-meta"><strong>${escapeHTML(author)}</strong><time>${escapeHTML(created)}</time></div>
                            <p>${escapeHTML(body)}</p>
                        </div>
                    </article>`;
            }).join("");
        }

        async function refreshCommunity() {
            try {
                const result = await requestJSON(`/api/explore/state?type=${encodeURIComponent(mediaType)}&id=${encodeURIComponent(mediaID)}`);
                const community = result.community || {};
                const user = result.user || {};
                if (communityLikeCount) {
                    const count = community.like_count ?? community.LikeCount ?? 0;
                    communityLikeCount.textContent = Number(count).toLocaleString();
                }

                const communityRatingAverage = document.getElementById("communityRatingAverage");
                const ratingCount = Number(community.rating_count ?? community.RatingCount ?? 0);
                const average = Number(community.community_rating ?? community.CommunityRating ?? 0);
                if (communityRatingAverage) communityRatingAverage.textContent = ratingCount ? average.toFixed(1) : "—";

                const liked = community.current_user_liked ?? community.CurrentUserLiked ?? false;
                updateLikeVisualState(liked === true);
                if (user.rating) applyRating(Number(user.rating));
                if (user.can_rate ?? user.CanRate) setRatingUnlocked();
                renderReviews(community.reviews || community.Reviews || []);
            } catch (_) {
                /* Server-rendered state remains usable if refresh is unavailable. */
            }
        }

        reviewSubmit?.addEventListener("click", async (event) => {
            if (!requireLogin()) return;
            const review = reviewInput?.value.trim() || "";
            if (!review) {
                showToast("Write a review before posting.");
                reviewInput?.focus();
                return;
            }

            addPressFeedback(reviewSubmit, event);
            reviewSubmit.disabled = true;
            if (reviewStatus) reviewStatus.textContent = "Publishing your review…";
            try {
                await requestJSON("/api/explore/review", {
                    method: "POST",
                    body: JSON.stringify(mediaPayload({ review }))
                });
                if (reviewInput) reviewInput.value = "";
                updateReviewComposer();
                if (reviewStatus) reviewStatus.textContent = "Review published to the MoviPilot community";
                showToast("Your review is now public on MoviPilot.");
                await refreshCommunity();
            } catch (error) {
                if (reviewStatus) reviewStatus.textContent = "Your review could not be published yet";
                showToast(error.message || "Could not publish review.");
            } finally {
                reviewSubmit.disabled = false;
            }
        });

        /* ---------------------------------------------------------
           Video filters: graceful fade then display toggle
           --------------------------------------------------------- */
        const normalizedType = (value) => String(value || "").trim().toLowerCase();
        document.querySelectorAll(".video-filter").forEach((filterButton) => {
            filterButton.addEventListener("click", () => {
                document.querySelectorAll(".video-filter").forEach((button) => {
                    button.classList.remove("is-active");
                    button.setAttribute("aria-pressed", "false");
                });
                filterButton.classList.add("is-active");
                filterButton.setAttribute("aria-pressed", "true");
                const selected = normalizedType(filterButton.dataset.videoFilter);

                document.querySelectorAll(".video-card").forEach((card) => {
                    const type = normalizedType(card.dataset.videoType || "other");
                    const visible = selected === "all" || type === selected;
                    if (visible) {
                        card.classList.remove("is-filtered-out");
                        if (!prefersReducedMotion) {
                            card.classList.add("is-filtering-out");
                            requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove("is-filtering-out")));
                        }
                    } else {
                        card.classList.add("is-filtered-out");
                    }
                });
            });
            filterButton.setAttribute("aria-pressed", String(filterButton.classList.contains("is-active")));
        });

        /* ---------------------------------------------------------
           Horizontal rails
           --------------------------------------------------------- */
        document.querySelectorAll("[data-scroll-target]").forEach((button) => {
            button.addEventListener("click", () => {
                const target = document.getElementById(button.dataset.scrollTarget);
                if (!target) return;
                const direction = Number(button.dataset.scrollDirection || 1);
                target.scrollBy({
                    left: direction * Math.max(target.clientWidth * 0.78, Math.min(360, target.clientWidth * 0.9)),
                    behavior: prefersReducedMotion ? "auto" : "smooth"
                });
            });
        });

        /* ---------------------------------------------------------
           Keyword fetching and result cards
           --------------------------------------------------------- */
        const keywordResultsPanel = document.getElementById("keywordResultsPanel");
        const keywordResultsGrid = document.getElementById("keywordResultsGrid");
        const keywordResultsTitle = document.getElementById("keywordResultsTitle");
        const keywordResultsClose = document.getElementById("keywordResultsClose");

        function recommendationCardHTML(movie) {
           const type = String(movie.media_type ?? movie.MediaType ?? "").trim().toLowerCase();
const id = Number(movie.id || movie.ID || 0);
if (!["movie", "tv"].includes(type) || !Number.isSafeInteger(id) || id <= 0) {
    console.warn("[MOVIPILOT EXPLORE] Skipping recommendation with invalid media identity", movie);
    return "";
}
            const title = movie.title || movie.Title || "Untitled";
            const poster = movie.poster_url || movie.PosterURL || "";
            const year = movie.year || movie.Year || "";
            const genre = movie.genre || movie.Genre || "";
            const rating = Number(movie.rating ?? movie.Rating ?? 0);
            return `
                <a class="recommend-card keyword-result-card" href="/explore?type=${encodeURIComponent(type)}&id=${id}">
                    <div class="recommend-poster-wrap">
                        ${poster ? `<img src="${escapeHTML(poster)}" alt="${escapeHTML(title)} poster" loading="lazy">` : ""}
                        <span class="recommend-poster-glow"></span>
                        ${rating > 0 ? `<span class="recommend-rating">★ ${rating.toFixed(1)}</span>` : ""}
                    </div>
                    <div class="recommend-card-content">
                        <h3>${escapeHTML(title)}</h3>
                        <div><span>${escapeHTML(year)}</span><i></i><span>${escapeHTML(genre)}</span></div>
                    </div>
                </a>`;
        }

        document.querySelectorAll(".keyword-chip").forEach((chip) => {
            chip.addEventListener("click", async () => {
                const keywordID = Number(chip.dataset.keywordId);
                const keywordName = chip.dataset.keywordName || "Keyword";
                if (!keywordID || !keywordResultsPanel || !keywordResultsGrid) return;

                keywordResultsPanel.hidden = false;
                keywordResultsGrid.innerHTML = '<div class="empty-inline">Fetching keyword matches…</div>';
                if (keywordResultsTitle) keywordResultsTitle.textContent = `Movies with “${keywordName}”`;
                keywordResultsPanel.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });

                try {
                    const result = await requestJSON(`/api/explore/keyword-movies?keyword_id=${encodeURIComponent(keywordID)}`);
                    const items = Array.isArray(result.results) ? result.results : [];
                    if (!items.length) {
                        keywordResultsGrid.innerHTML = '<div class="empty-inline">No matching movies were found for this keyword.</div>';
                        return;
                    }
                     const cardsHTML = items.map(recommendationCardHTML).filter(Boolean).join("");
       keywordResultsGrid.innerHTML = cardsHTML ||
           '<div class="empty-inline">The returned results did not contain valid movie links.</div>';
                } catch (error) {
                    keywordResultsGrid.innerHTML = `<div class="empty-inline">${escapeHTML(error.message || "Could not fetch keyword matches.")}</div>`;
                }
            });
        });
        keywordResultsClose?.addEventListener("click", () => {
            if (keywordResultsPanel) keywordResultsPanel.hidden = true;
        });

        /* ---------------------------------------------------------
           Scroll reveal: IntersectionObserver with safe fallback
           --------------------------------------------------------- */
        document.querySelectorAll(".reveal-on-load").forEach((element) => {
            requestAnimationFrame(() => element.classList.add("is-revealed"));
        });

        if ("IntersectionObserver" in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add("is-revealed");
                    observer.unobserve(entry.target);
                });
            }, { threshold: 0.08, rootMargin: "0px 0px -24px 0px" });
            document.querySelectorAll(".reveal-on-scroll").forEach((element) => observer.observe(element));
        } else {
            document.querySelectorAll(".reveal-on-scroll").forEach((element) => element.classList.add("is-revealed"));
        }

        /* ---------------------------------------------------------
           Auth UX and initial state sync
           --------------------------------------------------------- */
        document.querySelectorAll("[data-auth-required='true']").forEach((button) => {
            if (!loggedIn) button.setAttribute("aria-describedby", "exploreAuthNote");
        });

        if (!loggedIn && !document.getElementById("exploreAuthNote")) {
            const authNote = document.createElement("span");
            authNote.id = "exploreAuthNote";
            authNote.textContent = "Log in to save, like, rate, review, and create collections.";
            authNote.style.display = "none";
            document.body.appendChild(authNote);
        }

        if (loggedIn) refreshCommunity();
    });
})();
