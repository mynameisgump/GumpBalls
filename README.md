# GumpBalls

Gump balls

- Things to do:
  - Add fleshy texture to balls
  - Play with size of things
  - Play with areana more
  - Hitstop on collisions
  - Blood effects/dissolve on death
  - Different abillities?

- Use weird snowman flesh thing texture for balls
- Use a grey metal grate texture for the box
- Maybe add a parry move?
- Add Rollback netcode?

- Add 3d characters
- Title Select screen
- Have 3d Text above arena
- Make camera look at center point
  - Bad looks gross
  - Maybe have a smash style camera??
  -

- Should probably refactor
  - Currently

npx support?

# Server Ideas

- Ssh into game for a round robin tournament
-
-

# Claude Ideas:

Game = 2-ball physics duel. Charge dir, release for burst. Collision speed → dmg. Existing mech: gravity, friction, wall bounce, HP 100.

Class ideas fitting current sim:

Stat-twist classes (cheap, no new systems)

Tank — bigger radius, +HP, slower charge, lower dmg taken (heavier mass).
Glass cannon — smaller, less HP, faster charge, higher dmg multiplier.
Featherweight — low gravity affect, floaty, weak hits, hard to pin.
Lead — heavy gravity, fast falls, big slam dmg from above.
Greaseball — no horizontal friction, slides forever.
Bouncer — high wall restitution (1.0+), gains speed off walls.
Ability classes (need new server logic)

Parry — short window after input, reflects incoming velocity + bonus dmg (matches README parry note).
Dasher — instant short teleport on double-tap, cooldown.
Grappler — pull self toward opponent, sticky collision dmg-over-time.
Bomber — release explodes radially, no contact needed, self-knockback.
Mine — drops stationary hazard at charge spot, detonates on contact.
Phaser — brief intangibility, passes through opponent, no dmg either way.
Charger — overcharge tier: hold longer = more dmg, but stuck charging.
Vampire — heals % of dmg dealt.
Berserker — dmg scales as own HP drops.
Magnet — passive pull on opponent when charging.
Cheapest first pick: 2-3 stat-twist classes. Parry + Bomber best ability additions, both extend charge mech already there.

- Make Text Shake on collision, maybe flash a color
- Player ball color select
-
