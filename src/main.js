import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Import the text-analysis library
import nlp from 'compromise';
import nlpSpeech from 'compromise-speech';
nlp.plugin(nlpSpeech);

// --- Basic Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xededed);
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.5, 3);
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#c'), antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputEncoding = THREE.sRGBEncoding;
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(2, 5, 5);
scene.add(directionalLight);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;

// --- Lip-Sync and Model Setup ---
const lipSyncState = {
  phonemeQueue: [],
  currentPhoneme: 'sil', // 'sil' is for silence
  startTime: 0,
};
let model;
let morphTargetDict = {};
// A map to connect phonemes to our model's morph targets.
// Ready Player Me uses the OVR standard.
const phonemeMap = {
  'A': 'viseme_A', 'E': 'viseme_E', 'I': 'viseme_I', 'O': 'viseme_O',
  'U': 'viseme_U', 'F': 'viseme_FF', 'K': 'viseme_kk', 'P': 'viseme_PP',
  'R': 'viseme_RR', 'S': 'viseme_SS', 'T': 'viseme_DD', 'sil': 'viseme_sil'
};

// --- Model Loader ---
const loader = new GLTFLoader();
loader.load('/avatar.glb', (gltf) => {
  model = gltf.scene;
  scene.add(model);
  model.traverse((node) => {
    if (node.isSkinnedMesh && node.morphTargetDictionary) {
      morphTargetDict = node.morphTargetDictionary;
    }
  });
});

// --- UI and Voice Selection ---
const textInput = document.getElementById('text-input');
const speakButton = document.getElementById('speak-button');
const voiceSelect = document.getElementById('voice-select');
let availableVoices = [];

// Function to populate the voice dropdown
function populateVoiceList() {
  availableVoices = speechSynthesis.getVoices();
  voiceSelect.innerHTML = '';
  availableVoices.forEach(voice => {
    const option = document.createElement('option');
    option.textContent = `${voice.name} (${voice.lang})`;
    option.setAttribute('data-lang', voice.lang);
    option.setAttribute('data-name', voice.name);
    voiceSelect.appendChild(option);
  });
}

// Populate the list when voices are loaded, and handle browser differences.
populateVoiceList();
if (speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = populateVoiceList;
}

speakButton.addEventListener('click', () => {
  const text = textInput.value;
  if (text && !speechSynthesis.speaking) {
    speakText(text);
  }
});

// The Reliable Lip-Sync and Speech Function
function speakText(text) {
  // Use the compromise library to get phoneme data from the text
  const analysis = nlp(text).sounds();
  lipSyncState.phonemeQueue = analysis[0] || [];
  
  // Create the speech utterance
  const utterance = new SpeechSynthesisUtterance(text);
  
  // Find and set the selected voice
  const selectedOption = voiceSelect.selectedOptions[0].getAttribute('data-name');
  const selectedVoice = availableVoices.find(voice => voice.name === selectedOption);
  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }
  
  // When speech starts, begin our animation timer
  utterance.onstart = () => {
    speakButton.disabled = true;
    speakButton.innerText = "Speaking...";
    lipSyncState.startTime = Date.now();
    lipSyncState.currentPhoneme = 'sil';
  };

  // When speech ends, clean up
  utterance.onend = () => {
    speakButton.disabled = false;
    speakButton.innerText = "Speak";
    lipSyncState.phonemeQueue = [];
    lipSyncState.currentPhoneme = 'sil';
  };
  
  // Start the speech
  speechSynthesis.speak(utterance);
}

// --- Animation Loop ---
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  if (model && morphTargetDict && Object.keys(morphTargetDict).length) {
    // Check if speech is active and there are phonemes in the queue
    if (speechSynthesis.speaking && lipSyncState.phonemeQueue.length > 0) {
      const elapsedTime = Date.now() - lipSyncState.startTime;
      
      let current = lipSyncState.phonemeQueue[0];
      while (current && elapsedTime >= current.end) {
        lipSyncState.phonemeQueue.shift();
        if (!lipSyncState.phonemeQueue.length) {
          current = null;
          break;
        }
        current = lipSyncState.phonemeQueue[0];
      }
      
      if (current) {
        lipSyncState.currentPhoneme = current.phoneme;
      }
    }

    // Smoothly animate the morph targets based on the current phoneme
    for (const [key, value] of Object.entries(phonemeMap)) {
      const morphIndex = morphTargetDict[value];
      if (morphIndex !== undefined) {
        let targetInfluence = (key === lipSyncState.currentPhoneme) ? 1 : 0;
        
        model.traverse(node => {
          if (node.isSkinnedMesh && node.morphTargetInfluences) {
            node.morphTargetInfluences[morphIndex] = THREE.MathUtils.lerp(
              node.morphTargetInfluences[morphIndex],
              targetInfluence,
              0.4 // Adjust for more or less smoothness
            );
          }
        });
      }
    }
  }
  
  renderer.render(scene, camera);
}

const clock = new THREE.Clock();
animate();