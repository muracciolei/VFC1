C:\Users\Ivan\Documents\GAMES\VFC_1\VFC_1_GOAL_PROPMT.md

# PROJECT: VFC 1 - OPEN WORLD MOBILE

Act as a AAA game development team consisting of a senior game director, gameplay programmer, world designer, AI engineer, rendering engineer, physics engineer and mobile optimization specialist.

Your task is to build a highly ambitious, fully playable open-world crime sandbox inspired by the scale of freedom, gameplay depth, systemic interactions and cinematic quality of GTA V and GTA VI.

Do NOT copy copyrighted characters, missions, logos, map layouts, assets or storylines. Create an original game, original world, original characters and original identity.

## 1. GAME CONCEPT

Create a fully playable 3D open-world crime game set in a fictional, geographically compressed version of Italy.

The map should represent a miniature Italy, combining the country's most iconic geographical and cultural locations into one seamless playable world.

The player should be able to:

- Walk, run, sprint and jump.
- Steal, enter, drive and exit vehicles.
- Drive cars, motorcycles and other vehicles.
- Explore cities, villages, countryside, mountains, coastlines and highways.
- Commit crimes and attract police attention.
- Escape police pursuits.
- Participate in missions, side activities, random events and challenges.
- Interact with NPCs, shops, traffic, pedestrians and the environment.
- Explore the world freely without being forced to follow missions.

The game should feel like a real open-world game, not a technical demo.

---

# 2. THE WORLD — MINI ITALIA

Design a seamless world representing a compressed Italy.

The geographical layout should be recognizable and logical, but gameplay distances should be compressed enough that the player can travel between regions without spending excessive time.

Include representations of:

### Major cities

- Roma — monumental landmarks, historic center, government district, large roads.
- Milano — modern skyscrapers, business district, luxury cars, dense traffic.
- Napoli — dense streets, coastal views, narrow alleys, lively neighborhoods.
- Torino — elegant avenues, industrial areas and architecture.
- Firenze — historic streets, bridges, art-inspired architecture.
- Venezia — canals, bridges, islands and unique navigation.
- Bologna — porticoes, medieval streets and university atmosphere.
- Genova — port, steep roads, tunnels and maritime district.
- Palermo — Mediterranean architecture, markets and coastal neighborhoods.
- Bari — Adriatic waterfront and southern urban atmosphere.

### Other regions

- Italian countryside with vineyards, farms, olive groves and small villages.
- Alpine mountains with winding roads, tunnels and scenic viewpoints.
- Lake Como-inspired region.
- Amalfi-inspired coastline with dangerous narrow roads.
- Mediterranean beaches.
- Industrial zones.
- Airports.
- Ports.
- Motorways and toll booths.
- Gas stations.
- Rural roads.
- Hidden locations.
- Abandoned buildings.
- Underground parking.
- Shopping areas.

The map must have a coherent road network connecting its regions.

Do not create a collection of disconnected city scenes.

The world should have multiple layers of navigation:

- Pedestrian streets.
- Urban roads.
- Highways.
- Rural roads.
- Mountain roads.
- Tunnels.
- Bridges.

Create a world map and an in-game minimap.

---

# 3. GRAPHICS ENGINE — FULL FRONTEND WEBGL

Build the entire game as a frontend-only application.

Technology:

- Three.js.
- WebGL.
- TypeScript.
- Modern modular architecture.
- HTML/CSS UI.
- No backend.
- No server-dependent gameplay.
- Deployable to GitHub Pages.
- PWA-compatible architecture where practical.

The game must run directly in a browser, especially mobile Chrome.

Use procedural generation and original assets wherever possible.

Do not use static screenshots as the game world.

The player must be able to interact with actual 3D objects.

### Rendering requirements

- Atmospheric lighting.
- Dynamic shadows where performance allows.
- Day/night cycle.
- Sun position changing throughout the day.
- Fog and distance atmosphere.
- Sky rendering.
- Ambient lighting.
- Reflection effects where practical.
- Wet surfaces during rain.
- Particle effects.
- Dust.
- Tire smoke.
- Engine exhaust.
- Explosions.
- Realistic water.
- LOD system.
- Frustum culling.
- Instanced rendering for repeated objects.
- Adaptive quality settings.

Create a visually impressive game while keeping it performant on Android.

Use smart compromises rather than simply reducing everything to ugly low-poly graphics.

---

# 4. MOBILE-FIRST GAMEPLAY

The game is primarily designed for mobile phones.

This is not a desktop game with mobile buttons added afterward.

Design the entire game around touch controls, visibility and ergonomics.

### Touch controls

Use a minimal interface.

LEFT SIDE:
- A floating virtual joystick for movement.

RIGHT SIDE:
- A contextual action button.
- A small jump button when needed.
- Context-sensitive interaction.

WHEN DRIVING:
- Left/right steering.
- Accelerator.
- Brake/reverse.

Do not permanently display dozens of buttons.

Use contextual controls that change depending on the player's state.

For example:

- On foot: interaction, sprint, jump.
- Inside a vehicle: accelerator, brake, steering.
- Near an NPC: interact.
- Near a vehicle: enter/steal vehicle.
- During combat: shoot, aim, reload.

Use transparent, subtle buttons that don't obstruct the game.

Controls must be configurable.

Support:

- Touch input.
- Mouse and keyboard.
- Gamepad if possible.

Add a settings menu to adjust control sensitivity and button positions.

---

# 5. PLAYER CHARACTER

Create a third-person player controller.

The player must have:

- Walking.
- Running.
- Sprinting.
- Jumping.
- Smooth acceleration.
- Responsive turning.
- Camera-relative movement.
- Collision detection.
- Ground detection.
- Fall handling.
- Different movement behavior on slopes.
- Swimming if feasible.
- Entering and exiting vehicles.
- Interaction animations.

The movement must feel responsive and polished.

Avoid stiff movement, floating, sliding or instant rotation.

Implement a third-person camera with:

- Smooth follow.
- Camera collision.
- Adjustable distance.
- Adjustable sensitivity.
- Camera rotation.
- Vertical angle control.
- Dynamic positioning while driving.
- Cinematic camera options.

---

# 6. VEHICLES

Vehicles are a central gameplay system.

Create a variety of vehicle types:

- Compact Italian cars.
- Sports cars.
- Supercars.
- SUVs.
- Motorcycles.
- Vans.
- Trucks.
- Police vehicles.

Vehicles must be enterable and drivable.

Implement:

- Acceleration.
- Braking.
- Reverse.
- Steering.
- Handbrake.
- Drift mechanics.
- Tire friction.
- Vehicle weight.
- Suspension.
- Collision.
- Damage.
- Engine sounds.
- Skidding.
- Tire smoke.
- Vehicle recovery.
- Vehicle camera.

Vehicles should feel different from one another.

A small city car should behave differently from a supercar.

Create traffic that follows roads and reacts to the player.

Traffic vehicles should:

- Follow lanes.
- Stop at intersections.
- Avoid collisions.
- React to obstacles.
- React to dangerous driving.
- React to crashes.
- Sometimes honk.

Allow the player to steal vehicles and drive away.

---

# 7. POLICE AND CRIME SYSTEM

Create a dynamic crime and wanted system.

Wanted levels should escalate based on player actions.

Examples:

- Minor disturbance.
- Vehicle theft.
- Assault.
- Dangerous driving.
- Shooting.
- Major destruction.

Police should not simply spawn directly in front of the player.

They should search, investigate, chase and attempt to intercept.

Implement:

- Police patrols.
- Police detection.
- Search areas.
- Pursuit vehicles.
- Roadblocks.
- Escalating wanted levels.
- Police radio simulation.
- Escape mechanics.
- Hiding.
- Line-of-sight detection.
- Witnesses reporting crimes.
- Police response times depending on location.

The player must be able to lose the police by:

- Breaking line of sight.
- Changing vehicles.
- Hiding.
- Escaping the search area.
- Entering narrow streets.
- Reaching safe locations.

Create believable police AI behavior.

---

# 8. COMBAT

Create a complete basic third-person combat system.

Implement:

- Weapon inventory.
- Weapon switching.
- Aiming.
- Shooting.
- Reloading.
- Ammunition.
- Recoil.
- Damage.
- Hit detection.
- NPC reactions.
- Cover mechanics where feasible.
- Enemy AI.
- Death and respawn.

Combat should be responsive and designed for touch.

Use a contextual shooting interface instead of cluttering the screen.

---

# 9. NPCs AND WORLD SIMULATION

The world must feel alive.

Populate streets with:

- Pedestrians.
- Drivers.
- Police.
- Shopkeepers.
- Workers.
- Tourists.
- Criminals.

NPCs should have basic behaviors:

- Walking along sidewalks.
- Crossing streets.
- Talking.
- Standing.
- Using phones.
- Entering buildings where possible.
- Reacting to the player.
- Running from danger.
- Calling police.
- Reacting to crashes.
- Reacting to gunfire.
- Reacting to vehicles approaching dangerously.

Create a lightweight AI system with behavior states.

NPCs should not just be randomly moving objects.

---

# 10. MISSIONS AND ACTIVITIES

Create a mission system with a structured framework.

Include:

- Story missions.
- Car theft missions.
- Delivery missions.
- Street races.
- Chase missions.
- Time trials.
- Taxi missions.
- Police evasion challenges.
- Collectibles.
- Hidden locations.
- Random world events.
- Gang encounters.
- Side activities.

Missions should have:

- Objectives.
- Checkpoints.
- Progress tracking.
- Failure conditions.
- Rewards.
- Mission markers.
- Start and completion states.

Create at least 5 playable mission prototypes with actual gameplay, not merely text descriptions.

Mission ideas:

1. Steal a car in Milano and deliver it to a garage.
2. Escape police through the streets of Roma.
3. Race through mountain roads.
4. Transport a suspicious package across the countryside.
5. Chase a rival vehicle along the coast.

Create a mission progression system.

---

# 11. ECONOMY AND PROGRESSION

Implement:

- Cash.
- Rewards.
- Purchasable vehicles.
- Vehicle garages.
- Safehouses.
- Shops.
- Weapon purchases.
- Vehicle upgrades.
- Cosmetic customization.

Create an in-game economy.

Allow players to save their progression locally.

Use IndexedDB or LocalStorage for:

- Player position.
- Cash.
- Owned vehicles.
- Unlocked missions.
- Settings.
- Progression.

The game should resume where the player left off.

---

# 12. BUILDINGS AND INTERIORS

Create explorable buildings wherever practical.

Implement a modular interior system.

Examples:

- Garages.
- Shops.
- Apartments.
- Restaurants.
- Safehouses.
- Police stations.
- Warehouses.

Not every building needs an interior.

Use a smart mixture of:

- Enterable buildings.
- Locked buildings.
- Decorative buildings.
- Procedurally generated interiors.

Make buildings interactable rather than purely decorative.

---

# 13. AUDIO

Create an immersive audio system.

Implement:

- Engine sounds.
- Tire sounds.
- Traffic.
- Wind.
- Ambient city sounds.
- Birds.
- Rain.
- Footsteps.
- Weapon sounds.
- Police sirens.
- NPC voices or synthesized dialogue.
- Environmental audio based on location.

Use audio variation to prevent repetition.

Audio should change depending on whether the player is:

- In a city.
- In the countryside.
- Near the sea.
- In the mountains.
- Inside a vehicle.
- Inside a building.

---

# 14. WEATHER AND TIME

Create a dynamic world clock.

Implement:

- Morning.
- Afternoon.
- Sunset.
- Night.

Weather conditions:

- Clear.
- Cloudy.
- Rain.
- Heavy rain.
- Fog.

Weather should affect:

- Lighting.
- Visibility.
- Road friction.
- Vehicle handling.
- Ambient sounds.

---

# 15. USER INTERFACE

Create a high-quality modern interface.

The UI should feel like a polished commercial mobile game.

Include:

- Main menu.
- Continue game.
- New game.
- Settings.
- Pause menu.
- Map.
- Mission selection.
- Garage.
- Inventory.
- Character status.
- Wanted indicator.
- Cash.
- Mission notifications.
- Contextual interaction prompts.

The HUD must remain minimal.

Avoid excessive text.

Use smooth transitions and animations.

Make all menus touch-friendly.

---

# 16. MAP AND NAVIGATION

Create an interactive map of Mini Italia.

Include:

- Player position.
- Cities.
- Mission locations.
- Safehouses.
- Garages.
- Shops.
- Roads.
- Highways.
- Points of interest.

Allow the player to select destinations.

Create navigation markers in the 3D world.

Where possible, calculate a route through the road network.

---

# 17. PERFORMANCE — ANDROID PRIORITY

The game must prioritize performance on mobile Android devices.

Targets:

- Stable 30 FPS minimum on mid-range devices.
- 60 FPS on capable devices.
- Fast initial loading.
- Minimal memory usage.
- No unnecessary draw calls.
- No excessive physics calculations.
- No giant unoptimized meshes.

Implement:

- Dynamic resolution.
- Adaptive quality.
- Low, medium and high graphics settings.
- LOD.
- Object pooling.
- Instancing.
- Chunk-based world loading.
- Distance-based NPC simulation.
- Distance-based traffic simulation.
- Culling.
- Efficient collision detection.

Do not simulate every NPC at full intelligence when far from the player.

Use simplified simulation outside the active area.

---

# 18. WORLD ARCHITECTURE

Build a scalable world system.

Divide the map into geographical zones.

Load high-detail areas around the player.

Use simplified distant geometry.

Implement:

- World chunks.
- Streaming.
- Active zones.
- Inactive zones.
- NPC activation.
- Traffic activation.
- Distance-based simulation.

The player should not see loading screens when traveling between cities.

---

# 19. ART DIRECTION

Create an original visual identity.

Style:

- Realistic-inspired but optimized.
- Cinematic Italian atmosphere.
- Warm Mediterranean lighting.
- Distinct urban environments.
- Strong environmental storytelling.
- Recognizable architecture.
- High-quality road layouts.
- Detailed vehicles.
- Rich scenery.

The game must not look like a generic primitive-based programming demo.

Use procedural geometry only when it can produce visually convincing results.

Prioritize the quality of the playable environment over excessive menu functionality.

---

# 20. DEVELOPMENT STRATEGY

Do not attempt to implement every system as a broken placeholder simultaneously.

Build the game in progressive playable stages.

### STAGE 1 — CORE GAME

Immediately create:

- A functioning 3D world.
- Third-person character.
- Camera.
- Movement.
- A city block.
- Collision.
- One vehicle.
- Vehicle entry and exit.
- Functional driving.
- Mobile controls.

The first version must already be fun to play.

### STAGE 2 — OPEN WORLD

Add:

- Multiple connected districts.
- Roads.
- Traffic.
- NPCs.
- A larger map.
- World navigation.

### STAGE 3 — GAMEPLAY SYSTEMS

Add:

- Police.
- Wanted levels.
- Combat.
- Missions.
- Interactions.
- Economy.

### STAGE 4 — IMMERSION

Add:

- Weather.
- Day/night.
- Audio.
- Interiors.
- Random events.
- Improved AI.

### STAGE 5 — OPTIMIZATION AND POLISH

Add:

- Mobile optimization.
- Graphics settings.
- Improved animation.
- UI polish.
- Performance monitoring.
- Bug fixes.

---

# 21. CODE QUALITY

Create a clean modular architecture.

Separate:

- Rendering.
- World.
- Player.
- Camera.
- Vehicles.
- Physics.
- AI.
- NPCs.
- Police.
- Combat.
- Missions.
- Audio.
- UI.
- Persistence.
- Input.

Avoid a gigantic single JavaScript file.

Avoid unnecessary abstractions.

Do not create fake systems that only look functional.

Every button must work.

Every implemented feature must be playable.

Do not leave critical features as TODOs.

Do not replace gameplay with static mockups.

Do not claim a feature is implemented if it does not actually work.

---

# 22. FINAL OBJECTIVE

The final result should be a browser-based open-world crime game that feels like a miniature Italian sandbox.

The player should be able to:

Spawn into the world, walk through a believable Italian city, steal a vehicle, drive through traffic, explore different regions of Italy, encounter NPCs, commit crimes, trigger police pursuits, escape, complete missions, earn money, unlock vehicles and continue playing freely.

The priority order is:

1. FUN.
2. Responsive gameplay.
3. Excellent mobile controls.
4. A believable open world.
5. Driving quality.
6. NPC and police behavior.
7. Mission variety.
8. Visual quality.
9. Performance.
10. Expansion.

Make decisions independently as a professional game development team.

Do not stop after creating the project structure.

Do not stop after displaying a plan.

Start implementing the actual playable game immediately.

At the end of each development cycle, run the application, test the implemented systems, fix obvious bugs and continue improving the game.

The result must be a genuinely playable game, not a concept, mockup, landing page or technical showcase.