const pillCase = document.getElementById('pillCase');
const lid = document.getElementById('lid');

// Physics parameters
const dragSpringConstant = 500; // For smoother dragging
const detentSpringConstant = 1000; // Stiff for a strong snap to detent
const dampingCoefficient = 25; 
let position = 0; // Lid's position
let velocity = 0; // Lid's velocity
let isDragging = false;
let dragStartX = 0; // Initial drag X position on the lid
let mousePositionX = 0; // Current mouse X position
let detentEngaged = false; // Flag to indicate if the lid is engaged in a detent
const compartmentWidth = pillCase.offsetWidth / 7; // Compartment width
const detentActiveRange = compartmentWidth * 0.2; // Active range for detent force
const timeStep = 0.016; // Simulation timestep

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Generate an artificial impulse response for the reverb
function createArtificialImpulseResponse(duration = 1) {
    const sampleRate = audioCtx.sampleRate;
    const length = sampleRate * duration; // Duration in seconds
    const impulseResponse = audioCtx.createBuffer(2, length, sampleRate);
    const left = impulseResponse.getChannelData(0);
    const right = impulseResponse.getChannelData(1);
    
    // Custom frequencies array
    const customFrequencies = [4800, 5900, 3500, 2500, 1500]; // Based on spectrograph of Weekly Vitamin XL case. Could be custom for each case or find a pattern based on dimensions if one is identifiable
    
    for (let i = 0; i < length; i++) {
        let decayFactor = Math.exp(-i / (sampleRate * 0.04)); // Exponential decay
        let harmonicSignal = 0;
        
        // Generate signal based on custom frequencies
        customFrequencies.forEach((freq, index) => {
            const harmonicAmplitude = decayFactor / ((index + 1) * (index + 1)); // Adjust amplitude as in original
            harmonicSignal += Math.sin(2 * Math.PI * freq * (i / sampleRate)) * harmonicAmplitude;
        });

        left[i] = (Math.random() * 2 - 1 + harmonicSignal) * decayFactor;
        right[i] = (Math.random() * 2 - 1 + harmonicSignal) * decayFactor;
    }
    
    return impulseResponse;
}

// Create a ConvolverNode for the reverb effect
function createReverbNode() {
    const convolver = audioCtx.createConvolver();
    convolver.buffer = createArtificialImpulseResponse(); // Apply the artificial impulse response
    return convolver;
}

function createMetallicWhiteNoise() {
    const bufferSize = 2 * audioCtx.sampleRate,
          buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate),
          output = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }

    const whiteNoiseSource = audioCtx.createBufferSource();
    whiteNoiseSource.buffer = buffer;
    whiteNoiseSource.loop = true;

    // Adjusted: Bandpass filter settings for a more metallic resonance
    const bandpass = audioCtx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 4800; // Higher frequency for more 'shing'
    bandpass.Q.value = 3; // Increase Q for sharper resonance

    const reverbNode = createReverbNode();
    const gainNode = audioCtx.createGain();

    // Connect nodes in a chain
    whiteNoiseSource.connect(bandpass);
    bandpass.connect(gainNode);
    gainNode.connect(reverbNode);
    reverbNode.connect(audioCtx.destination);

    whiteNoiseSource.start(0);

    return {source: whiteNoiseSource, filter: bandpass, gain: gainNode};
}


// Using the metallic noise function with reverb convolution
const metallicNoise = createMetallicWhiteNoise();
const whiteNoiseSource = metallicNoise.source;
const gainNode = metallicNoise.gain;

function playDetentSnap() {
  // Create a buffer for white noise
  const bufferSize = audioCtx.sampleRate;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const output = buffer.getChannelData(0);

  // Fill the buffer with white noise
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }

  // Create a buffer source and set the buffer to the newly created noise buffer
  const noiseSource = audioCtx.createBufferSource();
  noiseSource.buffer = buffer;

  // Create a gain node to control the volume of the noise
  const gainNode = audioCtx.createGain();
  gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
  
  // Quickly fade out the noise to create a click sound
  gainNode.gain.exponentialRampToValueAtTime(0.005, audioCtx.currentTime + 0.005);

  // Connect everything
  noiseSource.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  // Start the noise source and stop it after a short duration to ensure it's a click
  noiseSource.start(audioCtx.currentTime);
  noiseSource.stop(audioCtx.currentTime + 0.02);
}

function updateSlidingSound() {
  // Define the range within which the lid is considered to be interacting with the pill case
  const maxInteractionPosition = compartmentWidth * 6; // Assuming the lid leaves the body after the last compartment
  
  // Adjust the volume based on the velocity of the lid
  let volume = Math.abs(velocity) / 6000; 
  volume = Math.min(Math.max(volume, 0), 1); // Ensure the volume is within 0 to 1
  
  // Only adjust the sound if the lid is moving within the pill case and not attempting to move past the left boundary
  if (position > 0 && position <= maxInteractionPosition) {
    gainNode.gain.value = volume;
  } else if (position === 0 && !isDragging) {
    // If the lid is at the start and not being dragged, ensure the sound is minimized
    gainNode.gain.value = 0;
  } else if (position >= maxInteractionPosition) {
    // Lid has left the body, start fading the sound out
    const fadeOutTime = audioCtx.currentTime + 1; // Adjust fade out duration as needed
    gainNode.gain.exponentialRampToValueAtTime(0.001, fadeOutTime); // Fade to near silence
  }
}

function simulatePhysics() {
  let springForce = 0;
  let dampingForce = -dampingCoefficient * velocity;
  let detentForce = 0;

  // Calculate displacement for dragging
  const dragDisplacement = mousePositionX - dragStartX - position;

  if (isDragging && position >= 0) {
    // Apply a milder spring force for dragging
    springForce = dragSpringConstant * dragDisplacement;
  }

  // Calculate the position for the final detent, which is one compartment width beyond the last compartment
  const finalDetentPosition = compartmentWidth * 7; // Assuming 7 compartments

  // Always calculate detent force, whether dragging or not, but limit to within the final detent position
  const nearestDetent = Math.round(position / compartmentWidth) * compartmentWidth;
  const detentDisplacement = nearestDetent - position;
  
  const inDetentRange = Math.abs(detentDisplacement) <= detentActiveRange && position <= finalDetentPosition;

  // Play detent snap sound if in detent range and not previously engaged
  if (inDetentRange && !detentEngaged) {
    playDetentSnap();
    detentEngaged = true; // Prevent further snaps until we leave the detent range
  } else if (!inDetentRange && detentEngaged) {
    detentEngaged = false; // Reset flag once we leave the detent range
  }
  
  // Update sliding sound
  updateSlidingSound();

  // Check if the lid is within the bounds for detent activation, including the final detent position
  if (Math.abs(detentDisplacement) <= detentActiveRange && position <= finalDetentPosition) {
    // Strong detent force within a narrow active range
    detentForce = detentSpringConstant * detentDisplacement;
  }

  // Combine forces
  const totalForce = springForce + detentForce + dampingForce;
  const acceleration = totalForce;
  velocity += acceleration * timeStep;
  position += velocity * timeStep;

  // Ensure the lid does not move past the left boundary
  if (position < 0) {
    position = 0;
    velocity = -velocity * 0.2; // Optionally reset velocity to 0 to stop movement immediately
  }

  lid.style.left = `${position}px`;

  requestAnimationFrame(simulatePhysics);
}

function handleStartInteraction(event) {
  isDragging = true;
  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  const lidRect = lid.getBoundingClientRect();
  dragStartX = clientX - lidRect.left;
  mousePositionX = clientX;
}

function handleMoveInteraction(event) {
  if (isDragging) {
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const tentativePosition = clientX - dragStartX;
    if (tentativePosition >= 0) {
      mousePositionX = clientX;
    }
  }
}

function handleEndInteraction() {
  isDragging = false;
}

document.addEventListener('mousedown', handleStartInteraction);
document.addEventListener('mousemove', handleMoveInteraction);
document.addEventListener('mouseup', handleEndInteraction);

document.addEventListener('touchstart', handleStartInteraction);
document.addEventListener('touchmove', handleMoveInteraction);
document.addEventListener('touchend', handleEndInteraction);

requestAnimationFrame(simulatePhysics);