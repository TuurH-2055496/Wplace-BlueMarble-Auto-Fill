/** The main file. Everything in the userscript is executed from here.
 * @since 0.0.0
 */

import Overlay from './Overlay.js';
import Observers from './observers.js';
import ApiManager from './apiManager.js';
import TemplateManager from './templateManager.js';
import { consoleLog, consoleWarn } from './utils.js';

const name = GM_info.script.name.toString(); // Name of userscript
const version = GM_info.script.version.toString(); // Version of userscript
const consoleStyle = 'color: cornflowerblue;'; // The styling for the console logs

/** Injects code into the client
 * This code will execute outside of TamperMonkey's sandbox
 * @param {*} callback - The code to execute
 * @since 0.11.15
 */
function inject(callback) {
  const script = document.createElement('script');
  script.setAttribute('bm-name', name); // Passes in the name value
  script.setAttribute('bm-cStyle', consoleStyle); // Passes in the console style value
  script.textContent = `(${callback})();`;
  document.documentElement?.appendChild(script);
  script.remove();
}

/** What code to execute instantly in the client (webpage) to spy on fetch calls.
 * This code will execute outside of TamperMonkey's sandbox.
 * @since 0.11.15
 */
inject(() => {

  const script = document.currentScript; // Gets the current script HTML Script Element
  const name = script?.getAttribute('bm-name') || 'Blue Marble'; // Gets the name value that was passed in. Defaults to "Blue Marble" if nothing was found
  const consoleStyle = script?.getAttribute('bm-cStyle') || ''; // Gets the console style value that was passed in. Defaults to no styling if nothing was found
  const fetchedBlobQueue = new Map(); // Blobs being processed

  window.addEventListener('message', (event) => {
    const { source, endpoint, blobID, blobData, blink } = event.data;

    const elapsed = Date.now() - blink;

    // Since this code does not run in the userscript, we can't use consoleLog().
    console.groupCollapsed(`%c${name}%c: ${fetchedBlobQueue.size} Recieved IMAGE message about blob "${blobID}"`, consoleStyle, '');
    console.log(`Blob fetch took %c${String(Math.floor(elapsed / 60000)).padStart(2, '0')}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}.${String(elapsed % 1000).padStart(3, '0')}%c MM:SS.mmm`, consoleStyle, '');
    console.log(fetchedBlobQueue);
    console.groupEnd();

    // The modified blob won't have an endpoint, so we ignore any message without one.
    if ((source == 'blue-marble') && !!blobID && !!blobData && !endpoint) {

      const callback = fetchedBlobQueue.get(blobID); // Retrieves the blob based on the UUID

      // If the blobID is a valid function...
      if (typeof callback === 'function') {

        callback(blobData); // ...Retrieve the blob data from the blobID function
      } else {
        // ...else the blobID is unexpected. We don't know what it is, but we know for sure it is not a blob. This means we ignore it.

        consoleWarn(`%c${name}%c: Attempted to retrieve a blob (%s) from queue, but the blobID was not a function! Skipping...`, consoleStyle, '', blobID);
      }

      fetchedBlobQueue.delete(blobID); // Delete the blob from the queue, because we don't need to process it again
    }
  });

  // Spys on "spontaneous" fetch requests made by the client
  const originalFetch = window.fetch; // Saves a copy of the original fetch

  // Overrides fetch
  window.fetch = async function (...args) {

    // Capture request details before sending
    const requestUrl = ((args[0] instanceof Request) ? args[0]?.url : args[0]) || 'ignore';
    const requestOptions = args[1] || {};

    const response = await originalFetch.apply(this, args); // Sends a fetch
    const cloned = response.clone(); // Makes a copy of the response

    // Retrieves the endpoint name. Unknown endpoint = "ignore"
    const endpointName = requestUrl;

    // Check Content-Type to only process JSON
    const contentType = cloned.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {


      // Since this code does not run in the userscript, we can't use consoleLog().
      console.log(`%c${name}%c: Sending JSON message about endpoint "${endpointName}"`, consoleStyle, '');

      // Sends a message about the endpoint it spied on
      cloned.json()
        .then(jsonData => {
          window.postMessage({
            source: 'blue-marble',
            endpoint: endpointName,
            jsonData: jsonData
          }, '*');
        })
        .catch(err => {
          console.error(`%c${name}%c: Failed to parse JSON: `, consoleStyle, '', err);
        });
    } else if (contentType.includes('image/') && (!endpointName.includes('openfreemap') && !endpointName.includes('maps'))) {
      // Fetch custom for all images but opensourcemap

      const blink = Date.now(); // Current time

      const blob = await cloned.blob(); // The original blob

      // Since this code does not run in the userscript, we can't use consoleLog().
      console.log(`%c${name}%c: ${fetchedBlobQueue.size} Sending IMAGE message about endpoint "${endpointName}"`, consoleStyle, '');

      // Returns the manipulated blob
      return new Promise((resolve) => {
        const blobUUID = crypto.randomUUID(); // Generates a random UUID

        // Store the blob while we wait for processing
        fetchedBlobQueue.set(blobUUID, (blobProcessed) => {
          // The response that triggers when the blob is finished processing

          // Creates a new response
          resolve(new Response(blobProcessed, {
            headers: cloned.headers,
            status: cloned.status,
            statusText: cloned.statusText
          }));

          // Since this code does not run in the userscript, we can't use consoleLog().
          console.log(`%c${name}%c: ${fetchedBlobQueue.size} Processed blob "${blobUUID}"`, consoleStyle, '');
        });

        window.postMessage({
          source: 'blue-marble',
          endpoint: endpointName,
          blobID: blobUUID,
          blobData: blob,
          blink: blink
        });
      }).catch(exception => {
        const elapsed = Date.now();
        console.error(`%c${name}%c: Failed to Promise blob!`, consoleStyle, '');
        console.groupCollapsed(`%c${name}%c: Details of failed blob Promise:`, consoleStyle, '');
        console.log(`Endpoint: ${endpointName}\nThere are ${fetchedBlobQueue.size} blobs processing...\nBlink: ${blink.toLocaleString()}\nTime Since Blink: ${String(Math.floor(elapsed / 60000)).padStart(2, '0')}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}.${String(elapsed % 1000).padStart(3, '0')} MM:SS.mmm`);
        console.error(`Exception stack:`, exception);
        console.groupEnd();
      });

      // cloned.blob().then(blob => {
      //   window.postMessage({
      //     source: 'blue-marble',
      //     endpoint: endpointName,
      //     blobData: blob
      //   }, '*');
      // });
    }

    return response; // Returns the original response
  };
});

// Imports the CSS file from dist folder on github
const cssOverlay = GM_getResourceText("CSS-BM-File");
GM_addStyle(cssOverlay);

// Imports the Roboto Mono font family
var stylesheetLink = document.createElement('link');
stylesheetLink.href = 'https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,100..700;1,100..700&display=swap';
stylesheetLink.rel = 'preload';
stylesheetLink.as = 'style';
stylesheetLink.onload = function () {
  this.onload = null;
  this.rel = 'stylesheet';
};
document.head?.appendChild(stylesheetLink);

// CONSTRUCTORS
const observers = new Observers(); // Constructs a new Observers object
const overlayMain = new Overlay(name, version); // Constructs a new Overlay object for the main overlay
const overlayTabTemplate = new Overlay(name, version); // Constructs a Overlay object for the template tab
const templateManager = new TemplateManager(name, version, overlayMain); // Constructs a new TemplateManager object
const apiManager = new ApiManager(templateManager); // Constructs a new ApiManager object

overlayMain.setApiManager(apiManager); // Sets the API manager

const storageTemplates = JSON.parse(GM_getValue('bmTemplates', '{}'));
console.log(storageTemplates);
templateManager.importJSON(storageTemplates); // Loads the templates

buildOverlayMain(); // Builds the main overlay

overlayMain.handleDrag('#bm-overlay', '#bm-bar-drag'); // Creates dragging capability on the drag bar for dragging the overlay

apiManager.spontaneousResponseListener(overlayMain); // Reads spontaneous fetch responces

observeBlack(); // Observes the black palette color

consoleLog(`%c${name}%c (${version}) userscript has loaded!`, 'color: cornflowerblue;', '');

/** Observe the black color, and add the "Move" button.
 * @since 0.66.3
 */
function observeBlack() {
  const observer = new MutationObserver((mutations, observer) => {

    const black = document.querySelector('#color-1'); // Attempt to retrieve the black color element for anchoring

    if (!black) { return; } // Black color does not exist yet. Kills iteself

    let move = document.querySelector('#bm-button-move'); // Tries to find the move button

    // If the move button does not exist, we make a new one
    if (!move) {
      move = document.createElement('button');
      move.id = 'bm-button-move';
      move.textContent = 'Move ↑';
      move.className = 'btn btn-soft';
      move.onclick = function () {
        const roundedBox = this.parentNode.parentNode.parentNode.parentNode; // Obtains the rounded box
        const shouldMoveUp = (this.textContent == 'Move ↑');
        roundedBox.parentNode.className = roundedBox.parentNode.className.replace(shouldMoveUp ? 'bottom' : 'top', shouldMoveUp ? 'top' : 'bottom'); // Moves the rounded box to the top
        roundedBox.style.borderTopLeftRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
        roundedBox.style.borderTopRightRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
        roundedBox.style.borderBottomLeftRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
        roundedBox.style.borderBottomRightRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
        this.textContent = shouldMoveUp ? 'Move ↓' : 'Move ↑';
      }

      // Attempts to find the "Paint Pixel" element for anchoring
      const paintPixel = black.parentNode.parentNode.parentNode.parentNode.querySelector('h2');

      paintPixel.parentNode?.appendChild(move); // Adds the move button
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}



/** Deploys the overlay to the page with minimize/maximize functionality.
 * Creates a responsive overlay UI that can toggle between full-featured and minimized states.
 * 
 * Parent/child relationships in the DOM structure below are indicated by indentation.
 * @since 0.58.3
 */
function buildOverlayMain() {
  let isMinimized = false; // Overlay state tracker (false = maximized, true = minimized)

  overlayMain.addDiv({ 'id': 'bm-overlay', 'style': 'top: 10px; right: 75px;' })
    .addDiv({ 'id': 'bm-contain-header' })
    .addDiv({ 'id': 'bm-bar-drag' }).buildElement()
    .addImg({ 'alt': 'Blue Marble Icon - Click to minimize/maximize', 'src': 'https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/dist/assets/Favicon.png', 'style': 'cursor: pointer;' },
      (instance, img) => {
        /** Click event handler for overlay minimize/maximize functionality.
         * 
         * Toggles between two distinct UI states:
         * 1. MINIMIZED STATE (60×76px):
         *    - Shows only the Blue Marble icon and drag bar
         *    - Hides all input fields, buttons, and status information
         *    - Applies fixed dimensions for consistent appearance
         *    - Repositions icon with 3px right offset for visual centering
         * 
         * 2. MAXIMIZED STATE (responsive):
         *    - Restores full functionality with all UI elements
         *    - Removes fixed dimensions to allow responsive behavior
         *    - Resets icon positioning to default alignment
         *    - Shows success message when returning to maximized state
         * 
         * @param {Event} event - The click event object (implicit)
         */
        img.addEventListener('click', () => {
          isMinimized = !isMinimized; // Toggle the current state

          const overlay = document.querySelector('#bm-overlay');
          const header = document.querySelector('#bm-contain-header');
          const dragBar = document.querySelector('#bm-bar-drag');
          const coordsContainer = document.querySelector('#bm-contain-coords');
          const coordsButton = document.querySelector('#bm-button-coords');
          const createButton = document.querySelector('#bm-button-create');
          const enableButton = document.querySelector('#bm-button-enable');
          const disableButton = document.querySelector('#bm-button-disable');
          const coordInputs = document.querySelectorAll('#bm-contain-coords input');

          // Pre-restore original dimensions when switching to maximized state
          // This ensures smooth transition and prevents layout issues
          if (!isMinimized) {
            overlay.style.width = "auto";
            overlay.style.maxWidth = "300px";
            overlay.style.minWidth = "200px";
            overlay.style.padding = "10px";
          }

          // Define elements that should be hidden/shown during state transitions
          // Each element is documented with its purpose for maintainability
          const elementsToToggle = [
            '#bm-overlay h1',                    // Main title "Blue Marble"
            '#bm-contain-userinfo',              // User information section (username, droplets, level)
            '#bm-overlay hr',                    // Visual separator lines
            '#bm-contain-automation > *:not(#bm-contain-coords)', // Automation section excluding coordinates
            '#bm-input-file-template',           // Template file upload interface
            '#bm-contain-buttons-action',        // Action buttons container
            `#${instance.outputStatusId}`,       // Main status log textarea for user feedback
            '#bm-autofill-output',               // Auto-fill specific output textarea
            '#bm-progress-display',              // Progress display textarea
            '#bm-performance-display'            // Performance metrics display textarea
          ];

          // Apply visibility changes to all toggleable elements
          elementsToToggle.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
              element.style.display = isMinimized ? 'none' : '';
            });
          });
          // Handle coordinate container and button visibility based on state
          if (isMinimized) {
            // ==================== MINIMIZED STATE CONFIGURATION ====================
            // In minimized state, we hide ALL interactive elements except the icon and drag bar
            // This creates a clean, unobtrusive interface that maintains only essential functionality

            // Hide coordinate input container completely
            if (coordsContainer) {
              coordsContainer.style.display = 'none';
            }

            // Hide coordinate button (pin icon)
            if (coordsButton) {
              coordsButton.style.display = 'none';
            }

            // Hide create template button
            if (createButton) {
              createButton.style.display = 'none';
            }

            // Hide enable templates button
            if (enableButton) {
              enableButton.style.display = 'none';
            }

            // Hide disable templates button
            if (disableButton) {
              disableButton.style.display = 'none';
            }

            // Hide all coordinate input fields individually (failsafe)
            coordInputs.forEach(input => {
              input.style.display = 'none';
            });

            // Apply fixed dimensions for consistent minimized appearance
            // These dimensions were chosen to accommodate the icon while remaining compact
            overlay.style.width = '60px';    // Fixed width for consistency
            overlay.style.height = '76px';   // Fixed height (60px + 16px for better proportions)
            overlay.style.maxWidth = '60px';  // Prevent expansion
            overlay.style.minWidth = '60px';  // Prevent shrinking
            overlay.style.padding = '8px';    // Comfortable padding around icon

            // Apply icon positioning for better visual centering in minimized state
            // The 3px offset compensates for visual weight distribution
            img.style.marginLeft = '3px';

            // Configure header layout for minimized state
            header.style.textAlign = 'center';
            header.style.margin = '0';
            header.style.marginBottom = '0';

            // Ensure drag bar remains visible and properly spaced
            if (dragBar) {
              dragBar.style.display = '';
              dragBar.style.marginBottom = '0.25em';
            }
          } else {
            // ==================== MAXIMIZED STATE RESTORATION ====================
            // In maximized state, we restore all elements to their default functionality
            // This involves clearing all style overrides applied during minimization

            // Restore coordinate container to default state
            if (coordsContainer) {
              coordsContainer.style.display = '';           // Show container
              coordsContainer.style.flexDirection = '';     // Reset flex layout
              coordsContainer.style.justifyContent = '';    // Reset alignment
              coordsContainer.style.alignItems = '';        // Reset alignment
              coordsContainer.style.gap = '';               // Reset spacing
              coordsContainer.style.textAlign = '';         // Reset text alignment
              coordsContainer.style.margin = '';            // Reset margins
            }

            // Restore coordinate button visibility
            if (coordsButton) {
              coordsButton.style.display = '';
            }

            // Restore create button visibility and reset positioning
            if (createButton) {
              createButton.style.display = '';
              createButton.style.marginTop = '';
            }

            // Restore enable button visibility and reset positioning
            if (enableButton) {
              enableButton.style.display = '';
              enableButton.style.marginTop = '';
            }

            // Restore disable button visibility and reset positioning
            if (disableButton) {
              disableButton.style.display = '';
              disableButton.style.marginTop = '';
            }

            // Restore all coordinate input fields
            coordInputs.forEach(input => {
              input.style.display = '';
            });

            // Reset icon positioning to default (remove minimized state offset)
            img.style.marginLeft = '';

            // Restore overlay to responsive dimensions
            overlay.style.padding = '10px';

            // Reset header styling to defaults
            header.style.textAlign = '';
            header.style.margin = '';
            header.style.marginBottom = '';

            // Reset drag bar spacing
            if (dragBar) {
              dragBar.style.marginBottom = '0.5em';
            }

            // Remove all fixed dimensions to allow responsive behavior
            // This ensures the overlay can adapt to content changes
            overlay.style.width = '';
            overlay.style.height = '';
          }

          // ==================== ACCESSIBILITY AND USER FEEDBACK ====================
          // Update accessibility information for screen readers and tooltips

          // Update alt text to reflect current state for screen readers and tooltips
          img.alt = isMinimized ?
            'Blue Marble Icon - Minimized (Click to maximize)' :
            'Blue Marble Icon - Maximized (Click to minimize)';

          // No status message needed - state change is visually obvious to users
        });
      }
    ).buildElement()
    .addHeader(1, { 'textContent': name }).buildElement()
    .buildElement()

    .addHr().buildElement()

    .addDiv({ 'id': 'bm-contain-userinfo' })
    .addP({ 'id': 'bm-user-name', 'textContent': 'Username:' }).buildElement()
    .addP({ 'id': 'bm-user-droplets', 'textContent': 'Droplets:' }).buildElement()
    .addP({ 'id': 'bm-user-nextlevel', 'textContent': 'Next level in...' }).buildElement()
    .buildElement()

    .addHr().buildElement()

    .addDiv({ 'id': 'bm-contain-automation' })
    // .addCheckbox({'id': 'bm-input-stealth', 'textContent': 'Stealth', 'checked': true}).buildElement()
    // .addButtonHelp({'title': 'Waits for the website to make requests, instead of sending requests.'}).buildElement()
    // .addBr().buildElement()
    // .addCheckbox({'id': 'bm-input-possessed', 'textContent': 'Possessed', 'checked': true}).buildElement()
    // .addButtonHelp({'title': 'Controls the website as if it were possessed.'}).buildElement()
    // .addBr().buildElement()
    .addDiv({ 'id': 'bm-contain-coords' })
    .addButton({ 'id': 'bm-button-coords', 'className': 'bm-help', 'style': 'margin-top: 0;', 'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 6"><circle cx="2" cy="2" r="2"></circle><path d="M2 6 L3.7 3 L0.3 3 Z"></path><circle cx="2" cy="2" r="0.7" fill="white"></circle></svg></svg>' },
      (instance, button) => {
        button.onclick = () => {
          const coords = instance.apiManager?.coordsTilePixel; // Retrieves the coords from the API manager
          if (!coords?.[0]) {
            instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?');
            return;
          }
          instance.updateInnerHTML('bm-input-tx', coords?.[0] || '');
          instance.updateInnerHTML('bm-input-ty', coords?.[1] || '');
          instance.updateInnerHTML('bm-input-px', coords?.[2] || '');
          instance.updateInnerHTML('bm-input-py', coords?.[3] || '');
        }
      }
    ).buildElement()
    .addInput({ 'type': 'number', 'id': 'bm-input-tx', 'placeholder': 'Tl X', 'min': 0, 'max': 2047, 'step': 1, 'required': true }).buildElement()
    .addInput({ 'type': 'number', 'id': 'bm-input-ty', 'placeholder': 'Tl Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true }).buildElement()
    .addInput({ 'type': 'number', 'id': 'bm-input-px', 'placeholder': 'Px X', 'min': 0, 'max': 2047, 'step': 1, 'required': true }).buildElement()
    .addInput({ 'type': 'number', 'id': 'bm-input-py', 'placeholder': 'Px Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true }).buildElement()
    .buildElement()
    .addInputFile({ 'id': 'bm-input-file-template', 'textContent': 'Upload Template', 'accept': 'image/png, image/jpeg, image/webp, image/bmp, image/gif' }).buildElement()
    .addDiv({ 'id': 'bm-contain-buttons-template' })
    .addButton({ 'id': 'bm-button-enable', 'textContent': 'Enable' }, (instance, button) => {
      button.onclick = () => {
        instance.apiManager?.templateManager?.setTemplatesShouldBeDrawn(true);
        instance.handleDisplayStatus(`Enabled templates!`);
        // Enable auto-fill button when templates are enabled
  const autoFillBtn = document.querySelector('#bm-button-autofill');
  const modeBtn = document.querySelector('#bm-button-mode');
  const protectBtn = document.querySelector('#bm-button-protect');
  const placeNowBtn = document.querySelector('#bm-button-placenow');
  const sleepBtn = document.querySelector('#bm-button-sleep');
        if (instance.apiManager?.templateManager?.templatesArray.length && instance.apiManager?.templateManager?.templatesShouldBeDrawn) {
          if (autoFillBtn) {
            autoFillBtn.disabled = false;
          }
          if (modeBtn) {
            modeBtn.disabled = false;
          }
          if (protectBtn) {
            protectBtn.disabled = false;
          }
          if (placeNowBtn) {
            placeNowBtn.disabled = false;
          }
          if (sleepBtn) {
            sleepBtn.disabled = false;
          }

        }
      }
    }).buildElement()
    .addButton({ 'id': 'bm-button-create', 'textContent': 'Create' }, (instance, button) => {
      button.onclick = async () => {
        const input = document.querySelector('#bm-input-file-template');

        const coordTlX = document.querySelector('#bm-input-tx');
        if (!coordTlX.checkValidity()) { coordTlX.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return; }
        const coordTlY = document.querySelector('#bm-input-ty');
        if (!coordTlY.checkValidity()) { coordTlY.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return; }
        const coordPxX = document.querySelector('#bm-input-px');
        if (!coordPxX.checkValidity()) { coordPxX.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return; }
        const coordPxY = document.querySelector('#bm-input-py');
        if (!coordPxY.checkValidity()) { coordPxY.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return; }

        // Kills itself if there is no file
        if (!input?.files[0]) { instance.handleDisplayError(`No file selected!`); return; }

        // Clear template analysis cache when new template is created
        templateAnalysisCache = null;
        templateAnalysisCacheKey = null;
        console.log("PERFORMANCE: Template cache cleared for new template");

        await templateManager.createTemplate(input.files[0], input.files[0]?.name.replace(/\.[^/.]+$/, ''), [Number(coordTlX.value), Number(coordTlY.value), Number(coordPxX.value), Number(coordPxY.value)]);

        instance.handleDisplayStatus(`Drew to canvas!`);
      }
    }).buildElement()
    .addButton({ 'id': 'bm-button-disable', 'textContent': 'Disable' }, (instance, button) => {
      button.onclick = () => {
        instance.apiManager?.templateManager?.setTemplatesShouldBeDrawn(false);
        instance.handleDisplayStatus(`Disabled templates!`);
        
        // Clear template analysis cache when templates are disabled to free memory
        templateAnalysisCache = null;
        templateAnalysisCacheKey = null;
        performanceMetrics = { analysisTime: 0, cacheHits: 0, cacheMisses: 0 };
        console.log("PERFORMANCE: Template cache cleared (templates disabled)");
        
        // Disable auto-fill button when templates are disabled
        const autoFillBtn = document.querySelector('#bm-button-autofill');
        const modeBtn = document.querySelector('#bm-button-mode');
        const protectBtn = document.querySelector('#bm-button-protect');
        const placeNowBtn = document.querySelector('#bm-button-placenow');
        const sleepBtn = document.querySelector('#bm-button-sleep');
        if (autoFillBtn) {
          autoFillBtn.disabled = true;
        }
        if (modeBtn) {
          modeBtn.disabled = true;
        }
        if (protectBtn) {
          protectBtn.disabled = true;
        }
        if (placeNowBtn) {
          placeNowBtn.disabled = true;
        }
        if (sleepBtn) {
          sleepBtn.disabled = true;
        }
      }
    }).buildElement()
    .addButton({ 'id': 'bm-button-sleep', 'textContent': 'Sleep Mode: Off', 'disabled': true }, (instance, button) => {
      let isSleepModeOn = false;
      button.onclick = () => {
        isSleepModeOn = !isSleepModeOn;
        window.bmSleepMode = isSleepModeOn;
        button.textContent = `Sleep Mode: ${isSleepModeOn ? 'On' : 'Off'}`;
        instance.handleDisplayStatus(`💤 Sleep mode ${isSleepModeOn ? 'enabled' : 'disabled'}`);
      };
    }).buildElement()
    .addButton({ 'id': 'bm-button-autofill', 'textContent': 'Auto Fill', 'disabled': true }, (instance, button) => {
      let isRunning = false;
      const placedPixels = new Set();
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const colorMap = {
        0: [0, 0, 0, 0],        // Transparent
        1: [0, 0, 0, 255],      // Black
        2: [60, 60, 60, 255],   // Dark Gray
        3: [120, 120, 120, 255], // Gray
        4: [210, 210, 210, 255], // Light Gray
        5: [255, 255, 255, 255], // White
        6: [96, 0, 24, 255],    // Deep Red
        7: [237, 28, 36, 255],  // Red
        8: [255, 127, 39, 255], // Orange
        9: [246, 170, 9, 255],  // Gold
        10: [249, 221, 59, 255], // Yellow
        11: [255, 250, 188, 255], // Light Yellow
        12: [14, 185, 104, 255], // Dark Green
        13: [19, 230, 123, 255], // Green
        14: [135, 255, 94, 255], // Light Green
        15: [12, 129, 110, 255], // Dark Teal
        16: [16, 174, 166, 255], // Teal
        17: [19, 225, 190, 255], // Light Teal
        18: [40, 80, 158, 255],  // Dark Blue
        19: [64, 147, 228, 255], // Blue
        20: [96, 247, 242, 255], // Cyan
        21: [107, 80, 246, 255], // Indigo
        22: [153, 177, 251, 255], // Light Indigo
        23: [120, 12, 153, 255], // Dark Purple
        24: [170, 56, 185, 255], // Purple
        25: [224, 159, 249, 255], // Light Purple
        26: [203, 0, 122, 255],  // Dark Pink
        27: [236, 31, 128, 255], // Pink
        28: [243, 141, 169, 255], // Light Pink
        29: [104, 70, 52, 255],  // Dark Brown
        30: [149, 104, 42, 255], // Brown
        31: [248, 178, 119, 255], // Beige
        32: [170, 170, 170, 255], // Medium Gray
        33: [165, 14, 30, 255],  // Dark Red
        34: [250, 128, 114, 255], // Light Red
        35: [228, 92, 26, 255],  // Dark Orange
        36: [214, 181, 148, 255], // Light Tan
        37: [156, 132, 49, 255], // Dark Goldenrod
        38: [197, 173, 49, 255], // Goldenrod
        39: [232, 212, 95, 255], // Light Goldenrod
        40: [74, 107, 58, 255],  // Dark Olive
        41: [90, 148, 74, 255],  // Olive
        42: [132, 197, 115, 255], // Light Olive
        43: [15, 121, 159, 255], // Dark Cyan
        44: [187, 250, 242, 255], // Light Cyan
        45: [125, 199, 255, 255], // Light Blue
        46: [77, 49, 184, 255],  // Dark Indigo
        47: [74, 66, 132, 255],  // Dark Slate Blue
        48: [122, 113, 196, 255], // Slate Blue
        49: [181, 174, 241, 255], // Light Slate Blue
        50: [219, 164, 99, 255], // Light Brown
        51: [209, 128, 81, 255], // Dark Beige
        52: [255, 197, 165, 255], // Light Beige
        53: [155, 82, 73, 255],  // Dark Peach
        54: [209, 128, 120, 255], // Peach
        55: [250, 182, 164, 255], // Light Peach
        56: [123, 99, 82, 255],  // Dark Tan
        57: [156, 132, 107, 255], // Tan
        58: [51, 57, 65, 255],   // Dark Slate
        59: [109, 117, 141, 255], // Slate
        60: [179, 185, 209, 255], // Light Slate
        61: [109, 100, 63, 255], // Dark Stone
        62: [148, 140, 107, 255], // Stone
        63: [205, 197, 158, 255]  // Light Stone
      };

      // Helper function to format seconds as hh:mm:ss
      const formatTime = (seconds) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      };

      // Helper function to update auto-fill output textarea
      const updateAutoFillOutput = (message) => {
        const textarea = document.querySelector('#bm-autofill-output');
        if (textarea) {
          const timestamp = new Date().toLocaleTimeString();
          const newContent = `[${timestamp}] ${message}`;
          textarea.value = newContent + '\n';
          // Limit to last 20 lines to prevent excessive memory usage
          const lines = textarea.value.split('\n');
          if (lines.length > 20) {
            textarea.value = lines.slice(0, 20).join('\n');
          }
          textarea.scrollTop = 0; // Scroll to top to show latest messages
        }
      };

      // Helper function to update progress display textarea
      const updateProgressDisplay = (remainingPixels) => {
        const textarea = document.querySelector('#bm-progress-display');
        const estimatedTimeSeconds = remainingPixels * 30
        if (textarea) {
          let content = `Remaining Pixels: ${remainingPixels.toLocaleString()}`;

          if (estimatedTimeSeconds !== null && estimatedTimeSeconds > 0) {
            content += `\nEstimated Time: ${formatTime(estimatedTimeSeconds)}`;
          } else {
            content += '\nEstimated Time: N/A';
          }

          textarea.value = content;
        }
      };

      // Helper function to wait for an element to be available and optionally enabled
      const waitForElement = async (selector, options = {}) => {
        const {
          maxWaitTime = 100, // Maximum wait time in seconds
          checkEnabled = false, // Whether to check if element is enabled
          sleepInterval = 200, // How long to wait between checks (ms)
          logPrefix = 'AUTOFILL', // Prefix for console logs
          description = 'element', // Description for user feedback
          contextInfo = '' // Additional context info for messages
        } = options;

        let element = document.querySelector(selector);
        let waitCount = 0;

        console.log(`${logPrefix}: Looking for ${description}${contextInfo}...`);
        updateAutoFillOutput(`🔍 Looking for ${description}${contextInfo}...`);

        // Wait until the element is available and optionally enabled
        while ((!element || (checkEnabled && element.disabled)) && waitCount < maxWaitTime) {
          waitCount++;
          const waitMessage = `${logPrefix}: Waiting for ${description} to be ready${contextInfo}... (${waitCount}s/${maxWaitTime}s)`;
          console.log(waitMessage);
          updateAutoFillOutput(`⏳ Waiting for ${description} to be ready${contextInfo}... (${waitCount}s/${maxWaitTime}s)`);
          await sleep(sleepInterval);

          // Re-query the element in case the DOM changed
          element = document.querySelector(selector);
        }

        // Check for failure conditions
        if (!element) {
          const errorMessage = `❌ ${description} not found after waiting${contextInfo}`;
          updateAutoFillOutput(errorMessage);
          console.error(`${logPrefix}: ${description} not found after waiting${contextInfo}`);
          return { success: false, element: null, reason: 'not_found' };
        }

        if (checkEnabled && element.disabled) {
          const errorMessage = `❌ ${description} still disabled after waiting${contextInfo}`;
          updateAutoFillOutput(errorMessage);
          console.error(`${logPrefix}: ${description} still disabled after waiting${contextInfo}`);
          return { success: false, element, reason: 'disabled' };
        }

        // Success
        const successMessage = `✅ ${description} is ready${contextInfo}`;
        updateAutoFillOutput(successMessage);
        console.log(`${logPrefix}: ${description} is ready${contextInfo}`);
        return { success: true, element, reason: 'ready' };
      };

      /**
     * Decodes the extraColorsBitmap decimal value to determine which colors are owned
     * @param {number} extraColorsBitmap - The decimal representation from the /me endpoint
     * @returns {number[]} Array of color IDs that are owned (includes base colors 0-31)
     */
      function getOwnedColorsFromBitmap(extraColorsBitmap) {
        const ownedColors = [];


        // Colors 0-31 are always available (base colors)
        for (let i = 0; i <= 31; i++) {
          ownedColors.push(i);
        }

        // Check extra colors (32+) using the bitmap
        if (extraColorsBitmap && extraColorsBitmap > 0) {
          // Convert decimal to binary and check each bit
          for (let colorId = 32; colorId < 64; colorId++) { // Assuming max 64 colors total
            const bitPosition = colorId - 32; // Bit position for this color
            const isOwned = (extraColorsBitmap & (1 << bitPosition)) !== 0;

            if (isOwned) {
              ownedColors.push(colorId);
            }
          }
        }

        return ownedColors.sort((a, b) => a - b);
      }

      // Function to find closest color ID from RGB values
      const getColorIdFromRGB = (r, g, b, a) => {
        if (a === 0) return 0; // Transparent

        let minDistance = Infinity;
        let closestColorId = 1; // Default to black

        for (const [colorId, [cr, cg, cb]] of Object.entries(colorMap)) {
          if (colorId === '0') continue; // Skip transparent
          const distance = Math.sqrt((r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2);
          if (distance < minDistance) {
            minDistance = distance;
            closestColorId = parseInt(colorId);
          }
        }
        return closestColorId;
      };

      // Function to fetch current chunk data from the website
      const fetchChunkData = async (chunkX, chunkY) => {
        try {
          const response = await fetch(`https://backend.wplace.live/files/s0/tiles/${chunkX}/${chunkY}.png`);
          if (!response.ok) {
            console.log(`Chunk ${chunkX},${chunkY} not found or empty`);
            return null;
          }
          const blob = await response.blob();
          return await createImageBitmap(blob);
        } catch (error) {
          console.warn(`Failed to fetch chunk ${chunkX},${chunkY}:`, error);
          return null;
        }
      };

      // Helper function to update performance display
      const updatePerformanceDisplay = () => {
        const textarea = document.querySelector('#bm-performance-display');
        if (textarea) {
          const cacheEfficiency = performanceMetrics.cacheHits + performanceMetrics.cacheMisses > 0 
            ? (performanceMetrics.cacheHits / (performanceMetrics.cacheHits + performanceMetrics.cacheMisses) * 100).toFixed(1)
            : '0.0';
          
          const content = `Performance Metrics:
Cache: ${performanceMetrics.cacheHits} hits, ${performanceMetrics.cacheMisses} misses (${cacheEfficiency}% hit rate)
Last analysis: ${performanceMetrics.analysisTime.toFixed(2)}ms
Memory: Template analysis ${templateAnalysisCache ? 'cached' : 'not cached'}`;
          
          textarea.value = content;
        }
      };

      // Cache for template analysis to avoid reprocessing every time
      let templateAnalysisCache = null;
      let templateAnalysisCacheKey = null;
      let performanceMetrics = {
        analysisTime: 0,
        cacheHits: 0,
        cacheMisses: 0
      };

      const getNextPixels = async (count, ownedColors = []) => {
        const startTime = performance.now();
        const chunkGroups = {}; // Store pixels grouped by chunk
        if (!instance.apiManager?.templateManager?.templatesArray?.length) return [];

        const template = instance.apiManager.templateManager.templatesArray[0];
        const chunkedBitmaps = template.chunked;
        if (!chunkedBitmaps) {
          instance.handleDisplayError("Template has no pixel data (chunked property is missing).");
          return [];
        }

        // Create a cache key based on template and owned colors
        const cacheKey = `${Object.keys(chunkedBitmaps).length}_${ownedColors.join(',')}`;
        
        // Convert ownedColors array to Set for faster lookup
        const ownedColorsSet = new Set(ownedColors);

        // Check if we can use cached template analysis
        if (templateAnalysisCache && templateAnalysisCacheKey === cacheKey) {
          performanceMetrics.cacheHits++;
          const cacheTime = performance.now() - startTime;
          console.log(`PERFORMANCE: Using cached template analysis (${cacheTime.toFixed(2)}ms) - Cache hits: ${performanceMetrics.cacheHits}`);
          updateAutoFillOutput(`⚡ Cache hit! Analysis completed in ${cacheTime.toFixed(2)}ms (${performanceMetrics.cacheHits} hits)`);
          updatePerformanceDisplay();
        } else {
          performanceMetrics.cacheMisses++;
          const analysisStartTime = performance.now();
          console.log(`PERFORMANCE: Analyzing template (cache miss ${performanceMetrics.cacheMisses}) - this may take a moment for large templates`);
          updateAutoFillOutput('🔍 Analyzing template structure...');
          
          // Sort the chunk keys to ensure consistent processing order
          const sortedChunkKeys = Object.keys(chunkedBitmaps).sort();

          // Cache for fetched chunks to avoid multiple requests
          const chunkCache = new Map();

          // Collect ALL pixels that exist in the template (for edge detection)
          const allTemplatePixels = new Set();
          // Pre-analyzed template pixels with their properties
          const templatePixelCache = new Map();

          // Process ALL chunks and pre-analyze template pixels
          let processedChunks = 0;
          for (const key of sortedChunkKeys) {
            const bitmap = chunkedBitmaps[key];
            if (!bitmap) continue;

            processedChunks++;
            if (processedChunks % 10 === 0) {
              const partialTime = performance.now() - analysisStartTime;
              console.log(`PERFORMANCE: Processed ${processedChunks}/${sortedChunkKeys.length} chunks in ${partialTime.toFixed(2)}ms`);
              updateAutoFillOutput(`⚡ Analyzing chunk ${processedChunks}/${sortedChunkKeys.length} (${partialTime.toFixed(2)}ms)...`);
              // Allow UI updates during heavy processing
              await new Promise(resolve => setTimeout(resolve, 1));
            }

            // Parse the key: "chunkX,chunkY,tilePixelX,tilePixelY"
            const parts = key.split(',').map(Number);
            const [chunkX, chunkY, tilePixelX, tilePixelY] = parts;

            // Create template pixel analysis only once - cache the ImageData extraction
            let templateImageData;
            if (!templatePixelCache.has(key)) {
              const templateCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
              const templateCtx = templateCanvas.getContext('2d');
              templateCtx.drawImage(bitmap, 0, 0);
              templateImageData = templateCtx.getImageData(0, 0, bitmap.width, bitmap.height);
              templatePixelCache.set(key, templateImageData);
            } else {
              templateImageData = templatePixelCache.get(key);
            }

            // Pre-process template pixels and store their analysis
            const chunkPixels = [];
            
            // Scan each pixel in the template bitmap - batch process for efficiency
            // Start at (1,1) and step by 3 to skip the 3x3 grid pattern with transparency
            for (let y = 1; y < bitmap.height; y += 3) {
              for (let x = 1; x < bitmap.width; x += 3) {
                // Check template pixel
                const templatePixelIndex = (y * bitmap.width + x) * 4;
                const templateAlpha = templateImageData.data[templatePixelIndex + 3];
                if (templateAlpha === 0) {
                  continue; // Skip transparent pixels in template
                }

                // Get template pixel color
                const templateR = templateImageData.data[templatePixelIndex];
                const templateG = templateImageData.data[templatePixelIndex + 1];
                const templateB = templateImageData.data[templatePixelIndex + 2];
                const templateColorId = getColorIdFromRGB(templateR, templateG, templateB, templateAlpha);

                // Calculate "crushed down" coordinates - convert 3x3 grid position to logical position
                const logicalX = Math.floor((x - 1) / 3); // Convert bitmap x to logical x (0, 1, 2, ...)
                const logicalY = Math.floor((y - 1) / 3); // Convert bitmap y to logical y (0, 1, 2, ...)

                // Calculate final logical coordinates relative to the chunk
                const finalLogicalX = tilePixelX + logicalX;
                const finalLogicalY = tilePixelY + logicalY;
                const pixelKey = `${chunkX},${chunkY},${finalLogicalX},${finalLogicalY}`;

                // Add ALL template pixels to our comprehensive set (for edge detection)
                allTemplatePixels.add(pixelKey);

                // Store pixel data for later processing
                chunkPixels.push({
                  chunkX,
                  chunkY,
                  finalLogicalX,
                  finalLogicalY,
                  templateColorId,
                  pixelKey,
                  ownedColor: ownedColors.length === 0 || ownedColorsSet.has(templateColorId)
                });
              }
            }

            // Store processed chunk data with border classification
            templatePixelCache.set(`${key}_pixels`, chunkPixels);
          }

          // BORDER DETECTION: Classify all template pixels during initial analysis
          console.log("PERFORMANCE: Computing border detection during template analysis");
          updateAutoFillOutput('🔍 Analyzing border pixels (pixels next to transparent areas)...');
          
          // Pre-compute neighbor positions for faster lookup
          const neighborOffsets = [
            [-1, -1], [0, -1], [1, -1], // Top row
            [-1, 0],           [1, 0],  // Middle row (excluding center)
            [-1, 1],  [0, 1],  [1, 1]   // Bottom row
          ];

          // Build global template pixel lookup for border detection
          const globalTemplatePixels = new Set();
          for (const pixelKey of allTemplatePixels) {
            const [chunkX, chunkY, logicalX, logicalY] = pixelKey.split(',').map(Number);
            const globalX = (chunkX * 1000) + logicalX;
            const globalY = (chunkY * 1000) + logicalY;
            globalTemplatePixels.add(`${globalX},${globalY}`);
          }

          // Classify border pixels during template analysis
          const borderPixelKeys = new Set();
          let borderCheckCount = 0;
          
          for (const pixelKey of allTemplatePixels) {
            const [chunkX, chunkY, logicalX, logicalY] = pixelKey.split(',').map(Number);
            const globalX = (chunkX * 1000) + logicalX;
            const globalY = (chunkY * 1000) + logicalY;

            // Check if any neighbor position is transparent (missing from template)
            let isBorder = false;
            for (const [dx, dy] of neighborOffsets) {
              const neighGlobalX = globalX + dx;
              const neighGlobalY = globalY + dy;
              const neighborKey = `${neighGlobalX},${neighGlobalY}`;

              // If this neighbor doesn't exist in template, current pixel is on border
              if (!globalTemplatePixels.has(neighborKey)) {
                isBorder = true;
                break; // Found one missing neighbor, that's enough
              }
            }

            if (isBorder) {
              borderPixelKeys.add(pixelKey);
            }

            borderCheckCount++;
            if (borderCheckCount % 25000 === 0) {
              updateAutoFillOutput(`⚡ Border analysis progress: ${borderCheckCount}/${allTemplatePixels.size}...`);
              // Allow UI updates during heavy processing
              await new Promise(resolve => setTimeout(resolve, 1));
            }
          }

          console.log(`BORDER: Analyzed ${allTemplatePixels.size} pixels, found ${borderPixelKeys.size} border pixels`);
          updateAutoFillOutput(`✅ Border analysis complete: ${borderPixelKeys.size} border pixels identified`);

          // Cache the complete analysis including border information
          templateAnalysisCache = {
            allTemplatePixels,
            templatePixelCache,
            sortedChunkKeys,
            borderPixelKeys, // Add border classification to cache
            chunkCache: new Map() // Fresh cache for current state data
          };
          templateAnalysisCacheKey = cacheKey;
          
          performanceMetrics.analysisTime = performance.now() - analysisStartTime;
          console.log(`PERFORMANCE: Template analysis complete and cached in ${performanceMetrics.analysisTime.toFixed(2)}ms`);
          updateAutoFillOutput(`✅ Template analysis complete (${performanceMetrics.analysisTime.toFixed(2)}ms) and cached for future use!`);
          updatePerformanceDisplay();
        }

        // Use cached analysis
        const { allTemplatePixels, templatePixelCache, sortedChunkKeys } = templateAnalysisCache;
        const chunkCache = templateAnalysisCache.chunkCache;

        // Collect pixels that need placement by checking current state
        const allPixelsToPlace = [];
        let processedChunks = 0;
        
        for (const key of sortedChunkKeys) {
          const chunkPixels = templatePixelCache.get(`${key}_pixels`);
          if (!chunkPixels) continue;

          // Only fetch chunk data if we have pixels that might need placement
          const ownedPixelsInChunk = chunkPixels.filter(p => p.ownedColor);
          if (ownedPixelsInChunk.length === 0) continue;

          processedChunks++;
          if (processedChunks % 5 === 0) {
            updateAutoFillOutput(`🔍 Checking current state ${processedChunks} chunks...`);
            // Allow UI updates during processing
            await new Promise(resolve => setTimeout(resolve, 1));
          }

          // Parse the key for chunk coordinates
          const parts = key.split(',').map(Number);
          const [chunkX, chunkY] = parts;

          // Fetch current chunk data if not already cached
          const chunkKey = `${chunkX},${chunkY}`;
          if (!chunkCache.has(chunkKey) || 1) { // never cache --> could be updated by others or griefed
            const currentChunk = await fetchChunkData(chunkX, chunkY);
            chunkCache.set(chunkKey, currentChunk);
          }
          const currentChunk = chunkCache.get(chunkKey);

          // Process chunk pixels efficiently
          let currentImageData = null;
          if (currentChunk) {
            const currentCanvas = new OffscreenCanvas(currentChunk.width, currentChunk.height);
            const currentCtx = currentCanvas.getContext('2d');
            currentCtx.drawImage(currentChunk, 0, 0);
            currentImageData = currentCtx.getImageData(0, 0, currentChunk.width, currentChunk.height);
          }

          // Check each pixel in this chunk
          for (const pixel of ownedPixelsInChunk) {
            // Check if pixel is already placed correctly
            let needsPlacement = true;
            if (currentImageData) {
              // Make sure we're within bounds of the current chunk
              if (pixel.finalLogicalX >= 0 && pixel.finalLogicalX < currentImageData.width &&
                pixel.finalLogicalY >= 0 && pixel.finalLogicalY < currentImageData.height) {
                // Check current pixel color at this position
                const currentPixelIndex = (pixel.finalLogicalY * currentImageData.width + pixel.finalLogicalX) * 4;
                const currentR = currentImageData.data[currentPixelIndex];
                const currentG = currentImageData.data[currentPixelIndex + 1];
                const currentB = currentImageData.data[currentPixelIndex + 2];
                const currentAlpha = currentImageData.data[currentPixelIndex + 3];
                const currentColorId = getColorIdFromRGB(currentR, currentG, currentB, currentAlpha);

                // If the current pixel already matches the template color, skip it
                if (currentColorId === pixel.templateColorId) {
                  needsPlacement = false;
                }
              }
            }

            // Add pixels that need placement to our collection
            if (needsPlacement && !placedPixels.has(pixel.pixelKey)) {
              allPixelsToPlace.push(pixel);
            }
          }
        }

        // Get current mode from the mode button
        const modeBtn = document.querySelector('#bm-button-mode');
        const currentMode = modeBtn ? modeBtn.textContent.replace('Mode: ', '') : 'Border→Random';

        // Use cached border classification from template analysis
        updateAutoFillOutput('🎯 Using cached border analysis for optimal placement order...');
        
        console.log("getNextPixels: Using cached border detection results");
        let borderPixels = [];
        let interiorPixels = [];

        // Extract border classification from cached analysis
        const cachedBorderPixelKeys = templateAnalysisCache.borderPixelKeys;
        
        // Convert pixels to their key format and split based on cached border classification
        for (const pixel of allPixelsToPlace) {
          const pixelKey = `${pixel.chunkX},${pixel.chunkY},${pixel.finalLogicalX},${pixel.finalLogicalY}`;
          
          if (cachedBorderPixelKeys.has(pixelKey)) {
            borderPixels.push(pixel);
          } else {
            interiorPixels.push(pixel);
          }
        }

        console.log(`getNextPixels: Using cached results - ${borderPixels.length} border pixels, ${interiorPixels.length} interior pixels`);
        updateAutoFillOutput(`✅ Border placement strategy: ${borderPixels.length} border pixels first, then ${interiorPixels.length} interior pixels`);

        // Debug log to see what we're working with
        console.log(`DEBUG: Total pixels to place: ${allPixelsToPlace.length}, Border: ${borderPixels.length}, Interior: ${interiorPixels.length}`);

        // Sort pixels based on selected mode with border priority
        let prioritizedPixels = [];

        if (currentMode === 'Border→Scan') {
          // Sort each group by scan-line order (top-left to bottom-right)
          const sortByScanLine = (pixels) => {
            return pixels.sort((a, b) => {
              const globalYA = (a.chunkY * 1000) + a.finalLogicalY;
              const globalYB = (b.chunkY * 1000) + b.finalLogicalY;
              const globalXA = (a.chunkX * 1000) + a.finalLogicalX;
              const globalXB = (b.chunkX * 1000) + b.finalLogicalX;
              
              // Sort by Y first (top to bottom), then by X (left to right)
              if (globalYA !== globalYB) {
                return globalYA - globalYB;
              }
              return globalXA - globalXB;
            });
          };

          // Priority order: Border → Interior, both in scan-line order
          prioritizedPixels = [
            ...sortByScanLine([...borderPixels]),
            ...sortByScanLine([...interiorPixels])
          ];
          console.log(`📏 Border→Scan mode: ${borderPixels.length} border + ${interiorPixels.length} interior pixels in scan order`);
          updateAutoFillOutput(`📏 Border→Scan: Border first (${borderPixels.length} pixels), then interior`);
        } else { // Border→Random mode
          // Shuffle each group randomly but maintain priority order
          const shuffleArray = (array) => {
            const shuffled = [...array];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            return shuffled;
          };

          // Priority order: Border → Interior, both randomized within each group
          prioritizedPixels = [
            ...shuffleArray(borderPixels),
            ...shuffleArray(interiorPixels)
          ];
          console.log(`🎲 Border→Random mode: ${borderPixels.length} border + ${interiorPixels.length} interior pixels (randomized within groups)`);
          updateAutoFillOutput(`🎲 Border→Random: Border first (${borderPixels.length} pixels), then interior (randomized)`);
        }

        // Group pixels by chunk and apply count limit
        let totalPixelsAdded = 0;
        for (const pixel of prioritizedPixels) {
          if (totalPixelsAdded >= count) break;

          const chunkKey = `${pixel.chunkX},${pixel.chunkY}`;
          if (!chunkGroups[chunkKey]) {
            chunkGroups[chunkKey] = {
              chunkCoords: [pixel.chunkX, pixel.chunkY],
              pixels: []
            };
          }
          chunkGroups[chunkKey].pixels.push([pixel.finalLogicalX, pixel.finalLogicalY, pixel.templateColorId]);
          totalPixelsAdded++;
        }


        console.log(`\n📊 SUMMARY: Found ${allPixelsToPlace.length} total pixels that need placement (filtered by ${ownedColors.length} owned colors), returning ${totalPixelsAdded} pixels (${borderPixels.length} border priority)`);

        // Return both the chunk groups and the total remaining pixels count
        return {
          // Convert chunk groups to the desired format
          chunkGroups: Object.values(chunkGroups).map(group => [group.chunkCoords, group.pixels]),
          totalRemainingPixels: allPixelsToPlace.length
        };
      };

      // Helper function to intercept fetch requests for pixel placement
      const interceptFetchRequest = async (requestBodyBuilder, triggerAction, logPrefix = "REQUEST") => {
        const originalFetch = unsafeWindow.fetch;
        let interceptionActive = true;

        return new Promise(async (resolve, reject) => {
          unsafeWindow.fetch = async (...args) => {
            const url = args[0];
            const options = args[1] || {};
            const method = (options.method || 'GET').toUpperCase();

            if (!interceptionActive) {
              return originalFetch.apply(unsafeWindow, args);
            }

            if (method === 'POST' && typeof url === 'string' && url.includes('/pixel/')) {
              try {
                console.log(`${logPrefix}: Intercepting fetch request`);
                const originalBody = JSON.parse(options.body);
                const token = originalBody['t'];
                if (!token) {
                  throw new Error("Could not find security token 't'");
                }

                // Build the new request body using the provided builder function
                const { newBody, newUrl } = requestBodyBuilder(originalBody, token, url);
                const newOptions = { ...options, body: JSON.stringify(newBody) };

                interceptionActive = false;
                unsafeWindow.fetch = originalFetch;
                console.log(`${logPrefix}: Sending modified request`);
                const result = await originalFetch.call(unsafeWindow, newUrl || url, newOptions);
                resolve(result);
                return result;
              } catch (e) {
                interceptionActive = false;
                unsafeWindow.fetch = originalFetch;
                console.error(`${logPrefix}: Error during interception:`, e);
                reject(e);
              }
            } else {
              return originalFetch.apply(unsafeWindow, args);
            }
          };

          // Execute the trigger action that will cause the fetch request
          try {
            await triggerAction();
          } catch (error) {
            unsafeWindow.fetch = originalFetch;
            reject(error);
          }
        });
      };

      const placePixelsWithInterceptor = async (chunkCoords, pixels, retryCount = 0) => {
        if (!pixels || pixels.length === 0) return;
        const [chunkX, chunkY] = chunkCoords;

        const requestBodyBuilder = (originalBody, token, url) => {
          const newBody = {
            colors: pixels.map(([, , colorId]) => colorId),
            coords: pixels.flatMap(([logicalX, logicalY]) => [logicalX, logicalY]),
            t: token
          };
          const newUrl = `https://backend.wplace.live/s0/pixel/${chunkX}/${chunkY}`;
          return { newBody, newUrl };
        };

        const triggerAction = async () => {
          const canvas = document.querySelector('.maplibregl-canvas');
          if (!canvas) throw new Error("Could not find the map canvas.");

          const clickX = window.innerWidth / 2;
          const clickY = window.innerHeight / 2;
          const events = ['mousedown', 'click', 'mouseup'];
          for (const type of events) {
            const event = new MouseEvent(type, { clientX: clickX, clientY: clickY, bubbles: true });
            canvas.dispatchEvent(event);
            await sleep(50);
          }
          console.log("AUTOFILL: Starting...")

          // Wait for the final pixel placement button to be ready
          const finalButtonResult = await waitForElement(
            '.btn.btn-primary.btn-lg.sm\\:btn-xl.relative',
            {
              maxWaitTime: 100,
              checkEnabled: true,
              sleepInterval: 200,
              logPrefix: 'AUTOFILL',
              description: 'final pixel placement button',
              contextInfo: ''
            }
          );

          if (!finalButtonResult.success) {
            throw new Error(`Could not find or enable final paint button: ${finalButtonResult.reason}`);
          }

          console.log("AUTOFILL: Final button is ready - clicking now");
          finalButtonResult.element.click();
        };

        try {
          const result = await interceptFetchRequest(requestBodyBuilder, triggerAction, "AUTOFILL");

          // Check for rate limiting (429 status code)
          if (result.status === 429) {
            console.log(`Rate limited (429) on chunk ${chunkX},${chunkY}. Waiting 30s before retry...`);
            updateAutoFillOutput(`⏰ Rate limited! Waiting 30s before retry (attempt ${retryCount + 1})...`);
            await new Promise(resolve => setTimeout(resolve, 30000));
            updateAutoFillOutput(`🔄 Retrying pixel placement for chunk ${chunkX},${chunkY}...`);
            return await placePixelsWithInterceptor(chunkCoords, pixels, retryCount + 1);
          }

          return result;
        } catch (error) {
          throw error;
        }
      };

      // Place Now: reuse existing helpers to immediately place with available charges during auto-fill
      window.bmPlaceNow = async () => {
        try {
          if (!isRunning) {
            updateAutoFillOutput('⚠️ Auto-fill is not running. Start it first to use Place Now.');
            return;
          }

          if (!instance.apiManager?.templateManager?.templatesArray.length || !instance.apiManager?.templateManager?.templatesShouldBeDrawn) {
            updateAutoFillOutput('❌ No active template available for placement');
            return;
          }

          const charges = instance.apiManager?.charges;
          if (!charges || Math.floor(charges.count) < 1) {
            updateAutoFillOutput('⚠️ No charges available to place now');
            return;
          }

          const bitmap = instance.apiManager?.extraColorsBitmap || 0;
          const ownedColors = getOwnedColorsFromBitmap(bitmap);
          if (!ownedColors.length) {
            updateAutoFillOutput('❌ No owned colors found');
            return;
          }

          const pixelResult = await getNextPixels(Math.floor(charges.count), ownedColors);
          const chunkGroups = pixelResult?.chunkGroups || [];
          if (!chunkGroups.length) {
            updateAutoFillOutput('✅ No pixels to place right now');
            return;
          }

          const paintButtonResult = await waitForElement(
            '.btn.btn-primary.btn-lg.sm\\:btn-xl.relative.z-30',
            {
              maxWaitTime: 100,
              checkEnabled: true,
              sleepInterval: 200,
              logPrefix: 'PLACENOW',
              description: 'paint mode button',
              contextInfo: ''
            }
          );
          if (!paintButtonResult.success) {
            updateAutoFillOutput('❌ Place Now: paint button not found');
            return;
          }
          paintButtonResult.element.click();
          updateAutoFillOutput('✅ Place Now: opened paint menu');
          await sleep(500);

          const totalPixels = chunkGroups.reduce((sum, group) => sum + group[1].length, 0);
          updateAutoFillOutput(`🎯 Place Now: placing ${totalPixels} pixels across ${chunkGroups.length} chunks`);

          for (let i = 0; i < chunkGroups.length; i++) {
            if (!isRunning) break; // honor stop
            const [chunkCoords, pixels] = chunkGroups[i];
            const [chunkX, chunkY] = chunkCoords;

            // Reopen paint menu between chunks if needed
            if (i > 0) {
              const reopen = await waitForElement(
                '.btn.btn-primary.btn-lg.sm\\:btn-xl.relative.z-30',
                {
                  maxWaitTime: 100,
                  checkEnabled: false,
                  sleepInterval: 200,
                  logPrefix: 'PLACENOW',
                  description: 'paint button',
                  contextInfo: ` for chunk ${i + 1}`
                }
              );
              if (reopen.success) {
                reopen.element.click();
                await sleep(200);
              }
            }

            await placePixelsWithInterceptor(chunkCoords, pixels);
            pixels.forEach(([logicalX, logicalY]) => placedPixels.add(`${chunkX},${chunkY},${logicalX},${logicalY}`));
            updateAutoFillOutput(`✅ Place Now: placed ${pixels.length} in chunk (${chunkX},${chunkY})`);
          }

          updateAutoFillOutput('🎉 Place Now: batch complete');
        } catch (e) {
          console.error('Place Now error:', e);
          updateAutoFillOutput(`❌ Place Now error: ${e.message}`);
        }
      };


      button.onclick = async () => {
        if (isRunning) {
          console.log("AUTOFILL: User requested stop");
          isRunning = false;
          button.textContent = 'Auto Fill';
          updateAutoFillOutput('⏹️ Auto-fill stopped by user');

          // Clear protection interval but keep protection mode enabled
          // This allows protection to restart when auto-fill is restarted
          if (window.bmProtectionInterval) {
            console.log("AUTOFILL: Clearing protection interval (keeping protection mode enabled)");
            clearInterval(window.bmProtectionInterval);
            window.bmProtectionInterval = null;
            updateAutoFillOutput('🛡️ Protection monitoring paused (will resume when auto-fill restarts)');
          }

          return;
        }

        if (!instance.apiManager?.templateManager?.templatesArray.length || !instance.apiManager?.templateManager?.templatesShouldBeDrawn) {
          console.log("AUTOFILL: No active template available");
          updateAutoFillOutput('❌ No active template available');
          return;
        }

        // Fetch user data from /me endpoint to ensure we have fresh data
        try {
          const userData = await instance.apiManager.fetchUserData();
          if (userData) {
            console.log('Fetched fresh user data for auto-fill');
          } else {
            console.warn('Failed to fetch fresh user data, continuing with cached data');
          }
        } catch (error) {
          console.error('Error fetching fresh user data:', error);
        }

        console.log("AUTOFILL: Starting auto fill process");
        isRunning = true;
        button.textContent = 'Stop Fill';
        updateAutoFillOutput('🚀 Auto-fill started!');

        while (isRunning) {
          try {
            console.log("AUTOFILL: Starting new cycle");
            const charges = instance.apiManager?.charges;
            if (!charges) {
              console.log("AUTOFILL: No charge data available, waiting...");
              updateAutoFillOutput('⏳ Waiting for charge data...');
              await sleep(5000);
              continue;
            }

            const progressResult = await getNextPixels(1, getOwnedColorsFromBitmap(instance.apiManager?.extraColorsBitmap || 0)); // Pass 0 to get total count without processing pixels

            console.log(`AUTOFILL: Progress result: ${JSON.stringify(progressResult)}`);

            console.log(`AUTOFILL: Found ${progressResult.totalRemainingPixels} chunk groups to process`);
            if (progressResult.totalRemainingPixels === 0) {
              console.log("AUTOFILL: Template completed - no more pixels to place");
              console.log("AUTOFILL: Closing Paint Menu");
              updateAutoFillOutput('🎨 Closing Paint Menu...');
              updateAutoFillOutput('🎉 Template completed! All owned color pixels placed.');
              updateProgressDisplay(0); // Show completion

              // Start protection mode if enabled
              if (window.bmProtectMode) {
                console.log("AUTOFILL: Starting protection mode - monitoring");
                updateAutoFillOutput('🛡️ Protection mode active - monitoring template');
                // Ensure auto-fill is not considered running while monitoring
                isRunning = false;
                // Keep the button ready to start when protection detects damage
                button.textContent = 'Auto Fill';

                const protectionInterval = setInterval(async () => {
                  try {
                    console.log("PROTECT: Checking template integrity...");
                    updateAutoFillOutput('🔍 Checking template integrity...');

                    // Get owned colors from bitmap
                    const bitmap = instance.apiManager?.extraColorsBitmap || 0;
                    const ownedColors = getOwnedColorsFromBitmap(bitmap);

                    if (ownedColors.length === 0) {
                      console.log("PROTECT: No owned colors found, skipping check");
                      return;
                    }

                    // Check if there are pixels that need fixing
                    const checkResult = await getNextPixels(0, ownedColors);

                    if (checkResult.totalRemainingPixels > 0) {
                      console.log(`PROTECT: Found ${checkResult.totalRemainingPixels} pixels that need protection!`);
                      updateAutoFillOutput(`🚨 Protection alert: ${checkResult.totalRemainingPixels} pixels need fixing!`);

                      // Check if we have charges to fix some pixels
                      const charges = instance.apiManager?.charges;
                      if (charges && Math.floor(charges.count) > 0) {
                        const pixelsToFix = Math.min(Math.floor(charges.count), checkResult.totalRemainingPixels);
                        console.log(`PROTECT: Attempting to fix ${pixelsToFix} pixels with ${Math.floor(charges.count)} charges`);
                        updateAutoFillOutput(`🔧 Fixing ${pixelsToFix} pixels with available charges...`);

                        // Restart auto-fill by clicking the button
                        clearInterval(protectionInterval);
                        // Ensure the global interval reference is cleared
                        if (window.bmProtectionInterval) {
                          window.bmProtectionInterval = null;
                        }
                        updateAutoFillOutput('🛡️ Protection mode: Restarting auto-fill to fix damaged pixels');
                        // Make sure we go through the "start" path, not the "stop" path
                        isRunning = false;
                        button.click(); // This will restart the auto-fill
                      } else {
                        console.log("PROTECT: No charges available for immediate fixing");
                        updateAutoFillOutput('⚠️ Damage detected but no charges available for fixing');
                      }
                    } else {
                      console.log("PROTECT: Template is intact");
                      updateAutoFillOutput('✅ Template protection check: All pixels intact');
                    }
                  } catch (error) {
                    console.error('PROTECT: Error during protection check:', error);
                    updateAutoFillOutput(`❌ Protection error: ${error.message}`);
                  }
                }, 10000); // Check every 10 seconds

                // Store interval globally so it can be stopped if protect mode is disabled
                window.bmProtectionInterval = protectionInterval;
              } else {
                // If protection mode is not enabled, reset button text to "Auto Fill"
                button.textContent = 'Auto Fill';
                isRunning = false;
              }

              break;
            }

            updateProgressDisplay(progressResult.totalRemainingPixels);

            console.log(`AUTOFILL: Current charges: ${charges.count}/${charges.max}`);
            if (charges.count < charges.max && progressResult.totalRemainingPixels > Math.floor(charges.count)) {
              console.log(`AUTOFILL: Charges not full (${charges.count}/${charges.max}) and remaining pixels (${progressResult.totalRemainingPixels}) > available charges (${Math.floor(charges.count)}), refreshing user data`);
              // Refresh user data to get latest charge information
              updateAutoFillOutput('🔄 Refreshing user data for latest charges...');
              await instance.apiManager.fetchUserData();

              // Re-check charges after refresh
              const updatedCharges = instance.apiManager?.charges;
              if (updatedCharges && updatedCharges.count >= updatedCharges.max) {
                console.log("AUTOFILL: Charges are now full after refresh, proceeding");
                updateAutoFillOutput('✅ Charges are now full after refresh!');
                continue; // Skip waiting and proceed with pixel placement
              }

              console.log("AUTOFILL: Still need to wait for charges, calculating wait time");
              // Calculate exact wait time based on decimal portion and charges needed
              const chargesNeeded = charges.max - Math.floor(charges.count);
              const decimalPortion = charges.count - Math.floor(charges.count);
              const cooldownMs = charges.cooldownMs || 30000;

              // Calculate time until next full charge
              const timeToNextCharge = Math.ceil((1 - decimalPortion) * cooldownMs);

              // Calculate total wait time for all needed charges
              const totalWaitTime = timeToNextCharge + ((chargesNeeded - 1) * cooldownMs);

              console.log(`AUTOFILL: Waiting ${(totalWaitTime / 1000).toFixed(1)}s for ${chargesNeeded} charges`);
              updateAutoFillOutput(`⏱️ Precise timing: ${charges.count.toFixed(3)}/${charges.max} charges, waiting ${formatTime(totalWaitTime / 1000)}`);

              if (window.bmSleepMode) {
                // Low-power sleep: single await to minimize CPU work
                updateAutoFillOutput(`💤 Sleep mode: pausing for ${formatTime(totalWaitTime / 1000)} until enough charges`);
                await sleep(totalWaitTime);
              } else {
                // Default behavior: periodic updates and refreshes
                const startTime = Date.now();
                const endTime = startTime + totalWaitTime;
                let iterationCount = 0;

                while (Date.now() < endTime && isRunning) {
                  const remaining = Math.max(0, endTime - Date.now());
                  iterationCount++;

                  // Refresh user data every 10 seconds (10 iterations)
                  if (iterationCount % 10 === 0) {
                    console.log(`AUTOFILL: 10 seconds elapsed (iteration ${iterationCount}), refreshing user data`);
                    updateAutoFillOutput(`🔄 ${iterationCount}s elapsed - checking charges via data refresh`);
                    await instance.apiManager.fetchUserData();

                    // Check if we now have enough charges after the refresh
                    const updatedCharges = instance.apiManager?.charges;
                    if (updatedCharges && updatedCharges.count >= updatedCharges.max) {
                      console.log("AUTOFILL: Charges are now full after refresh, breaking wait loop");
                      updateAutoFillOutput("✅ Charges full after refresh - proceeding immediately!");
                      break;
                    } else {
                      console.log(`AUTOFILL: After refresh - charges: ${updatedCharges?.count.toFixed(3)}/${updatedCharges?.max}, continuing wait`);
                      updateAutoFillOutput(`📊 Refresh result: ${updatedCharges?.count.toFixed(3)}/${updatedCharges?.max} charges, continuing wait`);
                    }
                  }

                  const remainingTime = formatTime(remaining / 1000);
                  updateAutoFillOutput(`⏳ Charging ${remainingTime} remaining`);

                  // Sleep for 1 second or until the end time, whichever is shorter
                  await sleep(Math.min(1000, remaining));
                }
              }

              if (!isRunning) {
                console.log("AUTOFILL: Stopped during charge wait");
                break; // Exit if stopped during wait
              }
              console.log("AUTOFILL: Charge wait completed, continuing");
              continue;
            } else if (charges.count < charges.max) {
              // We have enough charges for the remaining pixels, no need to wait for full charges
              console.log(`AUTOFILL: Charges not full (${charges.count}/${charges.max}) but sufficient for remaining pixels (${progressResult.totalRemainingPixels}), proceeding with pixel placement`);
              updateAutoFillOutput(`⚡ Sufficient charges (${Math.floor(charges.count)}) for remaining pixels (${progressResult.totalRemainingPixels}), proceeding!`);
            }

            console.log("AUTOFILL: Proceeding with pixel placement");
            // Get owned colors from bitmap instead of UI scanning
            console.log("AUTOFILL: Getting owned colors from extraColorsBitmap...");
            updateAutoFillOutput('🔍 Getting owned colors from bitmap...');
            const bitmap = instance.apiManager?.extraColorsBitmap || 0;
            const ownedColors = getOwnedColorsFromBitmap(bitmap);
            console.log(`AUTOFILL: Found ${ownedColors.length} owned colors from bitmap ${bitmap}`);
            if (ownedColors.length === 0) {
              console.log("AUTOFILL: No owned colors found from bitmap, retrying in 10s");
              updateAutoFillOutput('❌ No owned colors found from bitmap! Retrying in 10s...');
              await sleep(10000);
              continue;
            }

            console.log(`AUTOFILL: Looking for up to ${charges.count} pixels to place`);
            updateAutoFillOutput(`⚡ Charges available (${charges.count}/${charges.max}). Finding up to ${charges.count} pixels from ${ownedColors.length} owned colors...`);
            const pixelResult = await getNextPixels(charges.count, ownedColors);
            const chunkGroups = pixelResult.chunkGroups;


            console.log(`AUTOFILL: Found ${chunkGroups.length} chunk groups to process`);
            if (progressResult.totalRemainingPixels === 0) {
              console.log("AUTOFILL: Template completed - no more pixels to place");
              console.log("AUTOFILL: Closing Paint Menu");
              updateAutoFillOutput('🎨 Closing Paint Menu...');
              const parentDiv = document.querySelector('.relative.px-3');
              const closeButton = parentDiv.querySelector('.btn.btn-circle.btn-sm svg path[d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"]')?.closest('button');
              if (closeButton) {
                closeButton.click();
              }
              isRunning = false;
              if (window.bmProtectMode) {
                button.textContent = 'Stop Fill'; // Keep as "Stop Fill" for protection mode
              } else {
                button.textContent = 'Auto Fill';
              }
              updateAutoFillOutput('🎉 Template completed! All owned color pixels placed.');
              updateProgressDisplay(0); // Show completion
              break;
            }

            // Step 1: Open the paint menu - wait for button to be available
            const paintButtonResult = await waitForElement(
              '.btn.btn-primary.btn-lg.sm\\:btn-xl.relative.z-30',
              {
                maxWaitTime: 100,
                checkEnabled: true,
                sleepInterval: 200,
                logPrefix: 'AUTOFILL',
                description: 'paint mode button',
                contextInfo: ''
              }
            );

            if (!paintButtonResult.success) {
              await sleep(5000);
              continue; // Retry the cycle
            }

            paintButtonResult.element.click();
            updateAutoFillOutput('✅ Clicked paint mode button');
            console.log('Clicked paint mode button');

            // Wait for the UI to update
            await sleep(500);

            // Calculate total pixels to place in this batch
            const totalPixels = chunkGroups.reduce((sum, group) => sum + group[1].length, 0);

            console.log(`AUTOFILL: Will place ${totalPixels} pixels across ${chunkGroups.length} chunks`);
            updateAutoFillOutput(`🎯 Found ${totalPixels} pixels to place in ${chunkGroups.length} chunks`);

            for (let chunkIndex = 0; chunkIndex < chunkGroups.length; chunkIndex++) {
              if (!isRunning) {
                console.log("AUTOFILL: Stopped during chunk processing");
                break;
              }

              const chunkGroup = chunkGroups[chunkIndex];
              const [chunkCoords, pixels] = chunkGroup;
              const [chunkX, chunkY] = chunkCoords;

              // For chunks after the first one and before the last one, reopen the paint menu
              console.log(`AUTOFILL: ChunkIndex: ${chunkIndex}`);
              if (chunkIndex > 0) {
                console.log(`AUTOFILL: Reopening paint menu for chunk ${chunkIndex + 1}/${chunkGroups.length}`);
                updateAutoFillOutput(`🎨 Reopening paint menu for chunk ${chunkIndex + 1}...`);

                // Wait until the paint button is available
                const paintButtonResult = await waitForElement(
                  '.btn.btn-primary.btn-lg.sm\\:btn-xl.relative.z-30',
                  {
                    maxWaitTime: 100,
                    checkEnabled: false,
                    sleepInterval: 200,
                    logPrefix: 'AUTOFILL',
                    description: 'paint button',
                    contextInfo: ` for chunk ${chunkIndex + 1}`
                  }
                );

                if (!paintButtonResult.success) {
                  console.error(`AUTOFILL: Could not find paint button for chunk ${chunkIndex + 1}, skipping chunk`);
                  updateAutoFillOutput(`❌ Could not find paint button for chunk ${chunkIndex + 1}, skipping`);
                  continue; // Skip this chunk
                }

                paintButtonResult.element.click();
                updateAutoFillOutput(`✅ Paint menu reopened for chunk ${chunkIndex + 1}`);
                await sleep(200); // Wait for the UI to update
              }

              console.log(`AUTOFILL: Processing chunk ${chunkX},${chunkY} with ${pixels.length} pixels`);
              updateAutoFillOutput(`🔄 Placing ${pixels.length} pixels in chunk ${chunkX},${chunkY}...`);
              await placePixelsWithInterceptor(chunkCoords, pixels);
              console.log("AUTOFILL: Finished Intercept")
              pixels.forEach(([logicalX, logicalY]) => placedPixels.add(`${chunkX},${chunkY},${logicalX},${logicalY}`));
              updateAutoFillOutput(`✅ Placed ${pixels.length} pixels in chunk (${chunkX},${chunkY})`);
            }

            console.log(`AUTOFILL: Completed placing ${totalPixels} pixels, starting UI cleanup`);

            if (isRunning) {
              console.log(`AUTOFILL: Batch completed successfully - ${totalPixels} pixels placed`);
              updateAutoFillOutput(`🎯 Batch complete: ${totalPixels} pixels placed`);
            }

            console.log("AUTOFILL: Waiting before next cycle");
            // Wait a short moment before the next cycle
            await sleep(10000);

          } catch (error) {
            console.error('AUTOFILL: Error during auto fill cycle:', error);
            updateAutoFillOutput(`❌ Error: ${error.message}. Retrying in 10s...`);
            await sleep(10000);
          }
        }
      };
    }).buildElement()
    .addButton({ 'id': 'bm-button-placenow', 'textContent': 'Place Now', 'disabled': true }, (instance, button) => {
      button.onclick = () => {
        if (typeof window.bmPlaceNow === 'function') {
          window.bmPlaceNow();
        }
      };
    }).buildElement()
    .addButton({ 'id': 'bm-button-mode', 'textContent': 'Mode: Border→Scan', 'disabled': true }, (instance, button) => {
      const modes = ['Border→Scan', 'Border→Random'];
      let currentModeIndex = 0;

      button.onclick = () => {
        currentModeIndex = (currentModeIndex + 1) % modes.length;
        button.textContent = `Mode: ${modes[currentModeIndex]}`;
      };
    }).buildElement()
    .addButton({ 'id': 'bm-button-protect', 'textContent': 'Protect: Off', 'disabled': true }, (instance, button) => {
      let isProtectModeOn = false;

      button.onclick = () => {
        isProtectModeOn = !isProtectModeOn;
        button.textContent = `Protect: ${isProtectModeOn ? 'On' : 'Off'}`;
        instance.handleDisplayStatus(`🛡️ Protection mode ${isProtectModeOn ? 'enabled' : 'disabled'}`);

        // Store the protect mode state globally so auto-fill can access it
        window.bmProtectMode = isProtectModeOn;

        // Clear any existing protection interval when disabling
        if (!isProtectModeOn && window.bmProtectionInterval) {
          clearInterval(window.bmProtectionInterval);
          window.bmProtectionInterval = null;
          instance.handleDisplayStatus('🛡️ Protection monitoring stopped');
        }

        // When turning protection off, only stop auto-fill if it's currently running protection
        // This prevents interference when auto-fill is running in normal mode
        if (!isProtectModeOn && window.bmProtectionInterval) {
          const autoFillBtn = document.querySelector('#bm-button-autofill');
          if (autoFillBtn && autoFillBtn.textContent === 'Stop Fill') {
            updateAutoFillOutput('🛡️ Protection disabled - stopping auto-fill');
            autoFillBtn.click();
            instance.handleDisplayStatus('🔄 Auto-fill stopped due to protection disable');
          }
        }
      };
    }).buildElement()
    .buildElement()
    .addTextarea({ 'id': overlayMain.outputStatusId, 'placeholder': `Status: Sleeping...\nVersion: ${version}`, 'readOnly': true }).buildElement()
    .addTextarea({ 'id': 'bm-autofill-output', 'placeholder': 'Auto-Fill Output:\nWaiting for auto-fill to start...', 'readOnly': true }).buildElement()
    .addTextarea({ 'id': 'bm-progress-display', 'placeholder': 'Progress:\nWaiting for template analysis...', 'readOnly': true }).buildElement()
    .addTextarea({ 'id': 'bm-performance-display', 'placeholder': 'Performance:\nCache: 0 hits, 0 misses\nAnalysis time: 0ms', 'readOnly': true, 'style': 'height: 60px; font-size: 11px;' }).buildElement()
    .addDiv({ 'id': 'bm-contain-buttons-action' })
    .addDiv()
    .addButton({ 'id': 'bm-button-convert', 'className': 'bm-help', 'innerHTML': '🎨', 'title': 'Template Color Converter' },
      (instance, button) => {
        button.addEventListener('click', () => {
          window.open('https://pepoafonso.github.io/color_converter_wplace/', '_blank', 'noopener noreferrer');
        });
      }).buildElement()
    .buildElement()
    .addSmall({ 'textContent': 'Made by SwingTheVine', 'style': 'margin-top: auto;' }).buildElement()
    .buildElement()
    .buildElement()
    .buildOverlay(document.body);

  // Enable / Disable Auto Fill button based on if we have a template and if it should be drawn or not
  setTimeout(() => {
    const autoFillBtn = document.querySelector('#bm-button-autofill');
    const modeBtn = document.querySelector('#bm-button-mode');
    const protectBtn = document.querySelector('#bm-button-protect');
  const placeNowBtn = document.querySelector('#bm-button-placenow');
  const sleepBtn = document.querySelector('#bm-button-sleep');
    if (autoFillBtn) {
      if (overlayMain.apiManager?.templateManager?.templatesArray.length && overlayMain.apiManager?.templateManager?.templatesShouldBeDrawn) {
        autoFillBtn.disabled = false;
        modeBtn.disabled = false;
        if (protectBtn) protectBtn.disabled = false;
    if (placeNowBtn) placeNowBtn.disabled = false;
    if (sleepBtn) sleepBtn.disabled = false;
      } else {
        autoFillBtn.disabled = true;
        modeBtn.disabled = true;
        if (protectBtn) protectBtn.disabled = true;
    if (placeNowBtn) placeNowBtn.disabled = true;
    if (sleepBtn) sleepBtn.disabled = true;
      }
    }
  }, 0)
}