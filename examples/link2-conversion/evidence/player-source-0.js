/**
 * Link v2 player
 * Main application entry point and player for Link v2
 * Copyright (c) 2025 ertdfgcvb.xyz
 */

import { asyncPool } from './asyncpool.js'
import { FPS } from './timings.js'

const ZOOM_MIN = 0.5
const ZOOM_MAX = 5.0
const RESOLUTION_HIGH = 4600
const RESOLUTION_DEFAULT = 1600
const LEADING_ZEROES = 3

const LOG = document.querySelector('pre')

export async function boot(config, settings) {

	let showInfo = false
	let paused = false
	let dir = 1

	const DESIRED_FPS = Math.max(1, settings.fps)
	const CONCURRENT_DOWNLOADS = Math.max(1, settings.cd)

	let zoom = clamp(settings.zoom, ZOOM_MIN, ZOOM_MAX)
	let dzoom = zoom

	const k = Object.keys(config)
	const e = settings.id
	const NAME = config[e] ? e : k[Math.floor(Math.random() * k.length)]

	const VAR = settings.var ? (config[NAME]?.var ? '_var' : '') : ''

	const RESOLUTION = settings.resolution == RESOLUTION_HIGH ? RESOLUTION_HIGH : RESOLUTION_DEFAULT

	const EXT = RESOLUTION == RESOLUTION_HIGH ? '.jpg' : '.webp'

	// ----- Download helper

	const downloadImage = (function() {
		const a = document.createElement('a')
		a.style.display = 'none'
		return function (frame) {
			const file = NAME + '_' + ('' + frame).padStart(LEADING_ZEROES, '0') + EXT
			const url = 'data/' + NAME + VAR + '/' + RESOLUTION_HIGH + '/' + file
			a.href = url
			a.download = file
			a.click()
		}
	})()

	// ----- Preload

	const NUM_FRAMES = (config[NAME]?.frames || 0)
	const MAX_FRAMES = Object.keys(config).reduce((max, key) => Math.max(max, config[key].frames), 0)

	// Multiply NUM_FRAMES by the number of times it can fit into MAX_FRAMES
	// for a more consistent mouse movement across different editions
	const NUM_FRAMES_STRETCHED = NUM_FRAMES * Math.floor(MAX_FRAMES / NUM_FRAMES)

	let frames = []
	const errors = []

	if (config[NAME]) {

		const logs = []
		let count = 0 // Use a counter as image loading is async

		function iterator(i) {
			return new Promise(resolve => {
				const folder = 'data/' + NAME + VAR + '/' + RESOLUTION + '/'

				const file = NAME + '_' + ('' + i).padStart(LEADING_ZEROES, '0') + EXT
				const img = new Image()
				img.src = folder + file
				img.onload = () => {
					logs.unshift(file)
					logs.length = Math.min(logs.length, 16)

					let out = ""
					out += progressBar(count + 1, NUM_FRAMES, 32) + ' '
					out += (count+1) + '/' + NUM_FRAMES + '\n\n'
					if (errors.length) out += errors.join('\n') + '\n\n'
					out += logs.join('\n')
					LOG.innerText = out

					count++
					resolve(img)
				}
				img.onerror = () => {
					errors.unshift(file + ' [error]')
					resolve(null)
				}
			})
		}
		frames = await asyncPool(CONCURRENT_DOWNLOADS, Array(NUM_FRAMES).keys(), iterator)

		if (errors.length == 0) {
			LOG.innerText = ""
			requestAnimationFrame(loop)
		} else {
			LOG.innerText = errors.length + (errors.length > 1 ? ' errors:' : ' error:') + '\n\n' + errors.join('\n')
		}
	}

	// ----- Canvas setup

	const canvas = document.querySelector('canvas')
	const ctx = canvas.getContext('2d')
	canvas.width = RESOLUTION
	canvas.height = RESOLUTION

	// ----- Keys

	window.addEventListener('keydown', e => {
		if (e.key == 'i') {
			showInfo = !showInfo
			LOG.innerText = ''
		} else if (e.key == ' ') {
			paused = !paused
		} else if (e.key == 'ArrowUp') {
			dzoom = clamp(dzoom + 0.1, ZOOM_MIN, ZOOM_MAX)
		} else if (e.key == 'ArrowDown') {
			dzoom = clamp(dzoom - 0.1, ZOOM_MIN, ZOOM_MAX)
		} else if (e.key == 'ArrowRight') {
			if(paused) frame = (NUM_FRAMES + frame - 1) % NUM_FRAMES
			dir = -1
		} else if (e.key == 'ArrowLeft') {
			if(paused) frame = (frame + 1) % NUM_FRAMES
			dir = 1
		} else if (e.key == 's') {
			downloadImage(frame)
		} else if (e.key == 'R') {
			const url = new URL(window.location)
			url.searchParams.set('resolution', RESOLUTION_HIGH)
			window.location = url.href
		} else if (e.key == 'r') {
			const url = new URL(window.location)
			url.searchParams.delete('resolution')
			window.location = url.href
		} else if (e.key == 'f') {
			if (document.body.requestFullscreen) {
				document.body.requestFullscreen().catch(e => console.warn(e))
			}
		} else if (e.key == 'v') {
			const url = new URL(window.location)
			if (VAR) {
				url.searchParams.delete('var')
			} else {
				url.searchParams.set('var', '1')
			}
			window.location = url.href
		}
	})

	// ----- Pointer

	const pointer = {
		x : 0,
		y : 0,
		pressed : false,
	}

	document.addEventListener('pointermove', e => {
		const px = pointer.x
		const py = pointer.y
		pointer.x = e.pageX
		pointer.y = e.pageY

		if (pointer.pressed) {
			if (pointer.x - px > 0) {
				dir = -1
			} else if( pointer.x - px < 0) {
				dir = 1
			}
		}

		e.preventDefault()
	})

	document.addEventListener('pointerup', e => {
		pointer.pressed = false
	})

	document.addEventListener('pointerdown', e => {
		pointer.y = e.pageY
		pointer.x = e.pageX
		pointer.pressed = true

		const absoluteFrame = clamp(Math.floor(pointer.x / innerWidth * NUM_FRAMES_STRETCHED), 0, NUM_FRAMES_STRETCHED - 1)
		relativeFrame = (NUM_FRAMES_STRETCHED * 2 - 1 - frame - absoluteFrame) % NUM_FRAMES_STRETCHED
	})

	document.addEventListener('gesturestart',  e => e.preventDefault())
	document.addEventListener('gesturechange', e => e.preventDefault())
	document.addEventListener('gestureend',    e => e.preventDefault())

	// ----- Boot

	const fps = new FPS(1000)
	let frame = 0
	let relativeFrame = 0
	let timeSample = -1000
	let fadeIn = 1

	function loop(time) {

		requestAnimationFrame(loop)

		// ---- Timings

		const delta = time - timeSample
		const interval = 1000 / DESIRED_FPS
		if (delta < interval && !pointer.pressed) {
			return
		}
		timeSample = time - delta % interval

		const currentFPS = Math.round(fps.tick(time))

		// ---- Resize

		zoom += (dzoom - zoom) * 0.1

		const min = Math.min(innerWidth, innerHeight) * zoom
		const bottom =  Math.min(0, Math.round(innerHeight - min * 1.1) / 2)
		const left = (innerWidth - min) / 2
		const top = Math.ceil(innerHeight - bottom - min) + 1
		canvas.style.width = min + 'px'
		canvas.style.height = min + 'px'
		canvas.style.transform = 'translate(' + left + 'px, ' + top + 'px)'

		// ---- Draw

		ctx.drawImage(frames[frame], 0, 0)

		fadeIn = Math.max(fadeIn - 0.03, 0)
		if (fadeIn > 0) {
			ctx.fillStyle = 'rgba(0, 0, 0,' + fadeIn + ')'
			ctx.fillRect(0, 0, canvas.width, canvas.height)
		}

		// ---- Info

		if (showInfo) {
			let out = ''
			out += fmt()
			out += fmt('id',     NAME + VAR)
			out += fmt('frames', NUM_FRAMES)
			out += fmt()
			out += fmt('resolution',    RESOLUTION + ' ' + (RESOLUTION == RESOLUTION_HIGH ? '(high)' : '(default)'))
			out += fmt('fps',           currentFPS + '←' + DESIRED_FPS)
			out += fmt('current frame', frame)
			out += fmt('direction',     dir)
			out += fmt('zoom',          dzoom.toFixed(1))
			out += fmt('width',         innerWidth)
			out += fmt('height',        innerHeight)
			out += fmt()
			out += fmt('i',     'toggle info')
			out += fmt('↑ ↓',   'set zoom')
			out += fmt('← →',   'prev./next frame')
			out += fmt('space', 'pause/resume')
			out += fmt('f',     'fullscreen')
			out += fmt('s',     'save frame')
			out += fmt('R',     'high resolution')
			out += fmt('r',     'default resolution')
			out += fmt('v',     'toggle variation')

			LOG.innerText = out
		}

		// ---- Frame increment

		if (pointer.pressed) {
			const absoluteFrame = clamp(Math.floor(pointer.x / innerWidth * NUM_FRAMES_STRETCHED), 0, NUM_FRAMES_STRETCHED - 1)
			// invert x
			frame = NUM_FRAMES - 1 - (relativeFrame + absoluteFrame) % NUM_FRAMES
		} else if (!paused) {
			frame = (NUM_FRAMES + frame + dir) % NUM_FRAMES
		}
	}

	function fmt(label, value, column = 18) {
		return ((!label && !value) ? ''.padEnd(column * 2, '-') : label.padEnd(column) + value) + '\n'
	}

	function clamp(v, min, max) {
		if (v < min) return min
		if (v > max) return max
		return v
	}

	function progressBar(current, total, width = 30) {
		const p = Math.round(current / total * width)
		return '█'.repeat(p) + '░'.repeat(width - p)
	}
}