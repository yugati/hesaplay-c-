// glTF/.glb bina modeli için Three.js görüntüleyici.
// Sürükle: döndür, kaydır: yakınlaştır (OrbitControls) + otomatik yavaş döndürme.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export function initBinaViewer(container, url, { onError, onLoaded } = {}) {
  const width = container.clientWidth || 300
  const height = container.clientHeight || 300

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b0f16)

  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000)
  camera.position.set(8, 8, 8)

  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  container.innerHTML = ''
  container.appendChild(renderer.domElement)

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.2))
  const dir = new THREE.DirectionalLight(0xffffff, 1.8)
  dir.position.set(10, 15, 10)
  scene.add(dir)
  scene.add(new THREE.GridHelper(60, 60, 0x2a3446, 0x1a2130))

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.6

  let mixer = null
  let frameId = null
  let disposed = false
  const clock = new THREE.Clock()

  new GLTFLoader().load(
    url,
    (gltf) => {
      if (disposed) return
      const model = gltf.scene
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      model.position.sub(center)
      scene.add(model)

      const maxDim = Math.max(size.x, size.y, size.z) || 1
      const dist = maxDim * 1.8
      camera.position.set(dist, dist * 0.8, dist)
      camera.near = maxDim / 100
      camera.far = maxDim * 50
      camera.updateProjectionMatrix()
      controls.target.set(0, 0, 0)
      controls.update()

      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(model)
        gltf.animations.forEach(clip => mixer.clipAction(clip).play())
      }
      if (onLoaded) onLoaded({ hasAnimations: !!(gltf.animations && gltf.animations.length) })
    },
    undefined,
    (err) => { if (!disposed && onError) onError(err) }
  )

  function animate() {
    frameId = requestAnimationFrame(animate)
    const dt = clock.getDelta()
    if (mixer) mixer.update(dt)
    controls.update()
    renderer.render(scene, camera)
  }
  animate()

  function onResize() {
    const w = container.clientWidth, h = container.clientHeight
    if (!w || !h) return
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }
  window.addEventListener('resize', onResize)

  const api = {
    setAutoRotate(v) { controls.autoRotate = v },
    dispose() {
      disposed = true
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', onResize)
      controls.dispose()
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose()
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
          mats.forEach(m => {
            for (const k in m) { if (m[k] && m[k].isTexture) m[k].dispose() }
            m.dispose()
          })
        }
      })
      renderer.dispose()
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement)
      }
    },
  }
  return api
}
