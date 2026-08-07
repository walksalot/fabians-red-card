import { redirect } from 'next/navigation';

/**
 * /music — the Music Timeline party game.
 *
 * The game is a self-contained, dependency-free static app that lives in
 * `public/music/`, outside the Next build (its own plain CSS and ES modules, no
 * Tailwind, no bundler), so all this route does is hand the browser to it.
 *
 * Deliberately no session gate: it's a game for whoever is in the room, and
 * making the family sign up for league accounts to guess song years would kill
 * it. Nothing here reads or writes league data.
 */
export default function MusicPage() {
  redirect('/music/index.html');
}
