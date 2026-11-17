import {joinRoom, selfId} from '../vendor/trystero.js'
import {RELAYS} from './relays.js'

export {RELAYS}

// Browser-only. Content travels over WebRTC; relays only do encrypted signalling.
export function connect({code, onBoard, onPresence}) {
  const room = joinRoom({appId: 'retro-tool', password: code, relayConfig: {urls: RELAYS}}, code)
  const hello = room.makeAction('hello')
  const board = room.makeAction('board')
  const presence = new Map()
  let me = null
  let lastBoard = null
  const quiet = () => {} // send() rejects if the peer vanished; peer-leave handles it
  const emit = () => onPresence([...presence.values()])

  hello.onMessage = (d, {peerId}) => {
    presence.set(peerId, {name: d?.name, joinedAt: d?.joinedAt, peerId})
    emit()
  }
  board.onMessage = d => onBoard(d)
  room.onPeerJoin = peerId => {
    if (me) hello.send(me, {target: peerId}).catch(quiet)
    if (lastBoard) board.send(lastBoard, {target: peerId}).catch(quiet)
  }
  room.onPeerLeave = peerId => {
    if (presence.delete(peerId)) emit()
  }

  return {
    selfId,
    announce(m) {
      me = {name: m.name, joinedAt: m.joinedAt}
      hello.send(me).catch(quiet)
    },
    broadcast(b) {
      lastBoard = b
      board.send(b).catch(quiet)
    },
    leave: () => room.leave(),
  }
}
