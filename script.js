/* PERSONALIZE: optional captions and descriptions, keyed by filename.
   Any other photos added to public/images/ are included automatically. */
const PHOTO_DETAILS = {
  "buaa-portrait.jpg": { caption: "With love, always", alt: "A portrait of Buaa" },
  "memory-01.jpg": { caption: "Soft moments, held close" },
  "memory-02.jpg": { caption: "The kind of joy that lingers" },
  "memory-03.jpg": { caption: "One for the memory box" },
  "memory-04.jpg": { caption: "Forever one of my favorites" },
  "WhatsApp Image 2026-10-20 at 00.11.19.jpeg": {
    caption: "Under the evening lights",
    alt: "Buaa standing among warm evening lights on a rooftop",
  },
  "WhatsApp Image 2026-10-20 at 00.11.20 (1).jpeg": {
    caption: "A birthday moment",
    alt: "Buaa smiling beside a birthday cake",
  },
  "WhatsApp Image 2026-10-20 at 00.11.20 (2).jpeg": {
    caption: "A beautiful day, just as you are",
    alt: "Buaa wearing a blue and white outfit",
  },
  "WhatsApp Image 2026-10-20 at 00.11.20.jpeg": {
    caption: "A ride worth remembering",
    alt: "Buaa sitting on a Royal Enfield motorcycle outdoors",
  },
  "WhatsApp Image 2026-10-20 at 00.11.21.jpeg": {
    caption: "A day on the water",
    alt: "Buaa sitting in a boat on a bright lake",
  },
};

const DEFAULT_CAPTIONS = [
  "Soft moments, held close",
  "The kind of joy that lingers",
  "One for the memory box",
  "A little piece of happiness",
];

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const photos = (window.BIRTHDAY_IMAGES || []).map((photo, index) => {
  const filename = photo.name.split("/").pop();
  const details = PHOTO_DETAILS[photo.name] || PHOTO_DETAILS[filename] || {};
  return {
    ...photo,
    caption: details.caption || DEFAULT_CAPTIONS[index % DEFAULT_CAPTIONS.length],
    alt: details.alt || `A photograph from our memory album, ${index + 1}`,
  };
});

const dialog = document.querySelector("#photo-dialog");
const lightboxWrap = document.querySelector("#lightbox-image-wrap");
const caption = document.querySelector("#photo-caption");
const count = document.querySelector("#photo-count");
const previousButton = document.querySelector("#previous-photo");
const nextButton = document.querySelector("#next-photo");
let currentPhoto = 0;

function showPhoto(index) {
  currentPhoto = (index + photos.length) % photos.length;
  const photo = photos[currentPhoto];
  const image = new Image();
  image.alt = photo.alt;
  image.src = photo.src;
  image.className = "lightbox-image";
  image.addEventListener("error", () => {
    const message = document.createElement("p");
    message.className = "lightbox-error";
    message.textContent = "This little memory is unavailable right now.";
    lightboxWrap.replaceChildren(message);
  });
  lightboxWrap.replaceChildren(image);
  caption.textContent = photo.caption;
  count.textContent = `${String(currentPhoto + 1).padStart(2, "0")} / ${String(photos.length).padStart(2, "0")}`;
  previousButton.hidden = nextButton.hidden = photos.length < 2;
}

function openPhoto(index) {
  showPhoto(index);
  dialog.showModal();
  document.body.classList.add("photo-open");
}

document.querySelector("#close-photo").addEventListener("click", () => dialog.close());
previousButton.addEventListener("click", () => showPhoto(currentPhoto - 1));
nextButton.addEventListener("click", () => showPhoto(currentPhoto + 1));
dialog.addEventListener("close", () => document.body.classList.remove("photo-open"));
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});
dialog.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    showPhoto(currentPhoto + (event.key === "ArrowRight" ? 1 : -1));
  }
});

// Mobile: native pinch-zoom remains available; a deliberate horizontal swipe
// switches photos without interfering with vertical scrolling or zoom gestures.
let touchStart;
lightboxWrap.addEventListener("touchstart", (event) => {
  touchStart = event.touches.length === 1
    ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
    : null;
}, { passive: true });
lightboxWrap.addEventListener("touchend", (event) => {
  if (!touchStart || event.touches.length) return;
  const dx = event.changedTouches[0].clientX - touchStart.x;
  const dy = event.changedTouches[0].clientY - touchStart.y;
  if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.6) {
    showPhoto(currentPhoto + (dx < 0 ? 1 : -1));
  }
  touchStart = null;
}, { passive: true });

function addPhoto(frame, container, photo) {
  const image = new Image();
  image.alt = photo.alt;
  image.decoding = "async";
  image.loading = frame.classList.contains("portrait-frame") ? "eager" : "lazy";
  if (image.loading === "eager") image.fetchPriority = "high";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "photo-button";
  button.setAttribute("aria-label", `View photo: ${photo.caption}`);
  button.disabled = true;
  button.append(image);
  button.addEventListener("click", () => openPhoto(photos.indexOf(photo)));

  image.addEventListener("load", () => {
    frame.classList.add("has-image");
    container.querySelector(".photo-placeholder")?.setAttribute("aria-hidden", "true");
    button.disabled = false;
  });
  image.addEventListener("error", () => {
    frame.classList.add("is-missing");
    button.hidden = true;
  });
  container.append(button);
  image.src = photo.src;
}

if (photos.length) {
  const portrait = photos.find((photo) => /(?:^|\/)buaa-portrait\./i.test(photo.name))
    || photos.find((photo) => /00\.11\.20 \(1\)\.jpeg$/i.test(photo.name))
    || photos[0];
  const portraitFrame = document.querySelector(".portrait-frame");
  addPhoto(portraitFrame, portraitFrame.querySelector(".portrait-inner"), portrait);
  portraitFrame.querySelector("figcaption > span").textContent = portrait.caption;

  const memories = photos.length > 1 ? photos.filter((photo) => photo !== portrait) : photos;
  const grid = document.querySelector("#memory-grid");
  const template = grid.querySelector(".memory-card").cloneNode(true);
  const variants = ["memory-card-tall", "memory-card-wide", "memory-card-small", "memory-card-small memory-card-offset"];
  grid.replaceChildren();

  memories.forEach((photo, index) => {
    const frame = template.cloneNode(true);
    frame.className = `memory-card reveal image-frame ${variants[index % variants.length]}`;
    frame.querySelector(".placeholder-number").textContent = String(index + 1).padStart(2, "0");
    const fallbackText = frame.querySelector(".photo-placeholder > span:last-child");
    fallbackText.textContent = "A little memory, held close.";
    frame.querySelector("figcaption > span").textContent = photo.caption;
    frame.querySelector(".caption-number").textContent = String(index + 1).padStart(2, "0");
    addPhoto(frame, frame.querySelector(".memory-image"), photo);
    grid.append(frame);
  });
  document.querySelector("#gallery-note").textContent = "Tap a photograph. Stay a little longer.";
}

// Content is visible by default, including when JavaScript is unavailable.
const revealItems = document.querySelectorAll(".reveal");
if (!reduceMotion.matches && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.1 });

  revealItems.forEach((item) => {
    item.classList.add("will-reveal");
    observer.observe(item);
  });

  reduceMotion.addEventListener("change", () => {
    if (!reduceMotion.matches) return;
    revealItems.forEach((item) => item.classList.add("is-visible"));
    observer.disconnect();
  });
}

const wishButton = document.querySelector("#wish-button");
const wishMessage = document.querySelector("#wish-message");
const cakeScene = document.querySelector(".cake-scene");
let wishMade = false;

wishButton.hidden = false;
wishButton.addEventListener("click", () => {
  wishMade = !wishMade;
  cakeScene.classList.toggle("is-wished", wishMade);
  cakeScene.classList.remove("is-celebrating");
  wishButton.querySelector("span").textContent = wishMade ? "Light it again" : "Make a wish";
  wishMessage.textContent = wishMade
    ? "May every good thing find you. Happy birthday, Buaa. ♡"
    : "A little light, and room for another wish. ♡";
  wishMessage.classList.add("is-visible");
  cakeScene.querySelector(".cake").setAttribute("aria-label", wishMade
    ? "A birthday cake with a candle, blown out for a birthday wish"
    : "A dusty rose birthday cake with a softly glowing candle");

  if (wishMade && !reduceMotion.matches) {
    // Restart the brief celebration after a candle is relit and wished on again.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => cakeScene.classList.add("is-celebrating"));
    });
  }
});

const letter = document.querySelector(".letter-paper");
const letterStorageKey = "buaa-birthday-letter";
if (letter) {
  try {
    const savedLetter = window.localStorage.getItem(letterStorageKey);
    if (savedLetter) letter.innerHTML = savedLetter;
  } catch {
    // Local storage may be unavailable; the letter remains editable.
  }

  letter.addEventListener("input", () => {
    try {
      window.localStorage.setItem(letterStorageKey, letter.innerHTML);
    } catch {
      // Source text remains the durable version when storage is unavailable.
    }
  });
}
