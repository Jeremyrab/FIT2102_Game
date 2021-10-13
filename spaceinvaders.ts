import { fromEvent, interval, merge } from 'rxjs';
import { map, filter, scan, mergeMap, takeUntil } from 'rxjs/operators';

type Key = 'ArrowLeft' | 'ArrowRight' | 'Space' | 'KeyR' | 'KeyZ' | 'KeyX' | 'KeyA' | 'KeyS'
type Event = 'keydown' | 'keyup'
// Possible bullet types
type BulletType = 'Pierce' | 'Wide'

function spaceinvaders() {
   // Inside this function you will use the classes and functions 
   // from rx.js
   // to add visuals to the svg element in pong.html, animate them, and make them interactive.
   // Study and complete the tasks in observable exampels first to get ideas.
   // Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/ 
   // You will be marked on your functional programming style
   // as well as the functionality that you implement.
   // Document your code!  

   const
      CONSTANTS = {
         CANVAS_SIZE: 600,
         SHIP_HEIGHT: 24,
         SHIP_WIDTH: 33,
         ALIEN_HEIGHT: 30,
         ALIEN_WIDTH: 30,
         BULLET_HEIGHT: 12,
         BULLET_WIDTH: 3,
         PLAYER_BULLET_CAP: 1,
         SHIELD_SEGMENT_HEIGHT: 20,
         SHIELD_SEGMENT_WIDTH: 20,
         INITIAL_LIVES: 5,
         BULLET_VELOCITY: 7,
         SHIELD_COST: 5,
         LIFE_COST: 10,
         BULLET_COST: 15
      },

      // Creates a new RNG class to generate random numbers
      rng = new RNG(100),
      nextRandom = () => rng.nextFloat()

   // Game State Transistions
   class Tick { constructor(public readonly elapsed: number) { } }
   class Move { constructor(public readonly direction: number) { } }
   class Shoot { constructor() { } }
   class Reset { constructor() { } }
   class RegenerateShields { constructor() { } }
   class ExtraLife { constructor() { } }
   class CustomBullet { constructor(public readonly bulletType: BulletType) { } }

   const
      // Taken from FRP Asteroids
      gameClock = interval(10)
         .pipe(map(elapsed => new Tick(elapsed))),

      keyObservable = <T>(e: Event, k: Key, result: () => T) =>
         fromEvent<KeyboardEvent>(document, e)
            .pipe(
               filter(({ code }) => code === k),
               filter(({ repeat }) => !repeat),
               map(result)
            ),

      startMoveLeft = keyObservable('keydown', 'ArrowLeft', () => new Move(-2)),
      startMoveRight = keyObservable('keydown', 'ArrowRight', () => new Move(2)),
      stopMoveLeft = keyObservable('keyup', 'ArrowLeft', () => new Move(0)),
      stopMoveRight = keyObservable('keyup', 'ArrowRight', () => new Move(0)),
      shoot = keyObservable('keydown', 'Space', () => new Shoot()),
      reset = keyObservable('keydown', 'KeyR', () => new Reset()),
      regenerateShields = keyObservable('keydown', 'KeyZ', () => new RegenerateShields),
      extraLife = keyObservable('keydown', 'KeyX', () => new ExtraLife),
      pierceBullet = keyObservable('keydown', 'KeyA', () => new CustomBullet('Pierce')),
      wideBullet = keyObservable('keydown', 'KeyS', () => new CustomBullet('Wide'))


   // Bodies include Ship, Bullet, Aliens and Shields Segments
   type Body = Readonly<{
      id: string,
      height: number,
      width: number,
      xvel: number,
      xpos: number,
      ypos: number,
      yvel: number,
      color?: string
   }>

   // Alien group is data relating to the aliens
   type AlienGroup = Readonly<{
      aliensList: Body[],
      timeSinceLastMove: number,
      direction: number,
      timeBetweenMoves: number,
   }>

   // ShipData is all the data relating to the ship
   type ShipData = Readonly<{
      ship: Body,
      bulletQueue: BulletType[],
      bullet: Body[],
      bulletActive: Boolean,
      lives: number
   }>

   // Game State
   type State = Readonly<{
      time: number,
      shipData: ShipData,
      bullets: Body[],
      aliens: AlienGroup,
      shields: Body[],
      points: number,
      level: number,
      gameOver: boolean,
      exit: Body[]
   }>

   const
      // Functions to create the various data types and bodies 
      createShip = () =>
         <Body>{
            id: 'ship',
            height: CONSTANTS.SHIP_HEIGHT,
            width: CONSTANTS.SHIP_WIDTH,
            xvel: 0,
            xpos: 272.5,
            ypos: 550,
            yvel: 0
         },

      createShipData = () =>
         <ShipData>{
            ship: createShip(),
            bulletQueue: [],
            bullet: [],
            bulletActive: false,
            lives: CONSTANTS.INITIAL_LIVES
         },

      createBullet = (id: number) => (b: Body) => (yvel: number) => (height: number) => (width: number) =>
         <Body>{
            id: `bullet${id}`,
            height: height,
            width: width,
            xvel: 0,
            xpos: b.xpos + (b.width - width) / 2,
            ypos: yvel < 0 ? b.ypos - height : b.ypos + yvel,
            yvel: yvel
         },

      // 55 Aliens in the swarm so by using ID numbers you can calculate their positions (e.g 14th Alien is 3rd Column, 2nd Row Down)
      createAlien = (id: number) => (level: number) =>
         <Body>{
            id: `alien${id}`,
            height: CONSTANTS.ALIEN_HEIGHT,
            width: CONSTANTS.ALIEN_WIDTH,
            xpos: id % 11 * 40 + 10,
            ypos: Math.floor(id / 11) * 40 + 60 + 10 * level,
            xvel: 10,
            yvel: 0
         },

      createAlienGroup = (level: number) =>
         <AlienGroup>{
            aliensList: [...Array(55)].map((_, i) => createAlien(i)(level)),
            timeSinceLastMove: 0,
            direction: 1,
            timeBetweenMoves: 55 * 3
         },

      // Similar to the createAlien() function that can relate ID numbers to position
      createShieldSegment = (id: number) =>
         <Body>{
            id: `shield${id}`,
            height: CONSTANTS.SHIELD_SEGMENT_HEIGHT,
            width: CONSTANTS.SHIELD_SEGMENT_WIDTH,
            xpos: 40 + id % 5 * CONSTANTS.SHIELD_SEGMENT_WIDTH + Math.floor(id / 5) % 4 * (40 + 5 * CONSTANTS.SHIELD_SEGMENT_WIDTH),
            ypos: 440 + Math.floor(id / CONSTANTS.SHIELD_SEGMENT_HEIGHT) % 3 * CONSTANTS.SHIELD_SEGMENT_HEIGHT,
            xvel: 0,
            yvel: 0,
            color: 'lime'
         },

      createShield = () =>
         [...Array(60)].map((_, i) => createShieldSegment(i)),

      createInitialState = (exit: Body[]) =>
         <State>{
            time: 0,
            shipData: createShipData(),
            bullets: [],
            aliens: createAlienGroup(0),
            shields: createShield(),
            points: 0,
            level: 0,
            gameOver: false,
            exit: exit
         },

      // Defines the intial state of the game
      initalState: State = createInitialState([]),

      // Handles all the collisiosn that tells the state what Bodies need to be removed and if important collisions happen (e.g The ship gets hit and loses a life)
      handleCollision = (s: State) => {
         const
            // Sees if two bodies are collied by comparing edges
            bodiesCollied = ([a, b]: [Body, Body]) => a.xpos < b.xpos + b.width && a.xpos + a.width > b.xpos && a.ypos + a.height > b.ypos && a.ypos < b.ypos + b.height,
            // Checks if the body is out of bounds on the yaxis
            OutOfBoundsY = (b: Body) => b.ypos < 0 || b.ypos > CONSTANTS.CANVAS_SIZE,
            // A curried function that gets all the collisions between two lists of bodies
            getCollision = (b1: Body[]) => (b2: Body[]) => {
               const allObjects = flatMap(b1, b => b2.map<[Body, Body]>(a => ([b, a])))
               return allObjects.filter(bodiesCollied)
            },

            // Gets all the shieldCollisions and then looks at the ones that are between shields and bullets and then shields and aliens
            shieldCollisons = getCollision(s.shields),
            shieldAndBulletCollisons = shieldCollisons([].concat(s.bullets, s.shipData.bullet)),
            shieldAndAlienCollisions = shieldCollisons(s.aliens.aliensList),

            // Get all the shipCollisions and then looks at the ones that are between ship and aliens and then ship and alien bullets
            shipCollisions = getCollision([s.shipData.ship]),
            shipAndAlienCollisions = shipCollisions(s.aliens.aliensList),
            shipAndAlienBulletCollisions = shipCollisions(s.bullets),

            // Get all the collisions between shipBullets and aliens
            shipBulletAndAlienCollisions = getCollision(s.shipData.bullet)(s.aliens.aliensList),

            // All previous functions get all possible collisions between the various objects

            // Find all the  player bullets that are to be removed from collisions and all bullets to be removed from being out of bounds
            shipBulletsColliedRemoved = [].concat(shieldAndBulletCollisons.map(([_, bullet]) => bullet), shipBulletAndAlienCollisions.map(([bullet, _]) => bullet)),
            shipBulletsOutOfBoundsRemoved = s.shipData.bullet.filter(OutOfBoundsY),
            shipBulletsRemoved = [].concat(shipBulletsColliedRemoved, shipBulletsOutOfBoundsRemoved),

            // Find all the alien bullets that are to be removed from collisions and all bullets to be removed from being out of bounds
            alienBulletsColliedRemoved = [].concat(shieldAndBulletCollisons, shipAndAlienBulletCollisions).map(([_, bullet]) => bullet),
            alienBulletsOutOfBoundsRemoved = s.bullets.filter(OutOfBoundsY),
            alienBulletsRemoved = [].concat(alienBulletsColliedRemoved, alienBulletsOutOfBoundsRemoved),

            // Find all the ship segments to be removed from collisions
            shieldRemoved = [].concat(shieldAndBulletCollisons, shieldAndAlienCollisions).map(([shield, _]) => shield),

            // Find all the aliens to be removed from collisions
            alienRemoved = shipBulletAndAlienCollisions.map(([_, aliens]) => aliens),

            // The following was taken from FRP Asteroids
            cut = except((a: Body) => (b: Body) => a.id === b.id);

         return {
            ...s,
            shipData: {
               ...s.shipData,
               // Cut all the shipBullets to be removed and check if the ship got hit by an alien bullet
               bullet: cut(s.shipData.bullet)(shipBulletsRemoved),
               lives: shipAndAlienBulletCollisions.length > 0 ? s.shipData.lives - 1 : s.shipData.lives
            },
            // Checks if either a shipAndAlien collides or the aliens reach the bottom of the screen if so makes it a gameover
            gameOver: shipAndAlienCollisions.length > 0 || s.aliens.aliensList.filter(OutOfBoundsY).length > 0 ? true : s.gameOver,
            // Cuts the removed bodies out of the corresponding lists
            bullets: cut(s.bullets)(alienBulletsRemoved),
            aliens: { ...s.aliens, aliensList: cut(s.aliens.aliensList)(alienRemoved) },
            shields: cut(s.shields)(shieldRemoved),
            // Adds the amount of aliens killed as points as each alien is worth 1 point
            points: s.points + shipBulletAndAlienCollisions.length,
            // Makes all the removed bodies into the exit array so they can be removed visually
            exit: [].concat(shipBulletsRemoved, alienBulletsRemoved, shieldRemoved, alienRemoved)
         }
      },

      // Checks if the ship is out of the screen and if so return it back to screen
      outOfBoundsX = (b: Body) =>
         b.xpos + b.xvel < 0 || b.xpos + b.width + b.xvel > CONSTANTS.CANVAS_SIZE,

      // Finds the closest alien with horizontal positioning having a much larger weighting than the vertical position
      alienDistance = ([a, b]: [Body, Body]) =>
         Math.abs((a.xpos + a.width / 2 - b.xpos + b.width / 2)) * 20 + Math.abs((a.ypos + a.height / 2 - b.ypos + b.height / 2)) * .2,

      // Updates a body to a new position
      updateBody = (b: Body) =>
         <Body>{
            ...b,
            // If the bodies new position would be outOfBounds on the x axis don't update the position
            xpos: outOfBoundsX(b) ? b.xpos : b.xpos + b.xvel,
            ypos: b.ypos + b.yvel
         },

      // Updates all data relating to the ship 
      updateShipData = (s: State) =>
         <ShipData>{
            ...s.shipData,
            ship: updateBody(s.shipData.ship),
            bullet: s.shipData.bullet.map(updateBody),
            // If there are too many player bullets on the screen set bulletActive to true so the player is unable to fire more bullets
            bulletActive: s.shipData.bullet.length >= CONSTANTS.PLAYER_BULLET_CAP
         },

      // Updates all data relating to the alienGroup
      updateAlienGroup = (s: State) => {
         // Checks if there is one alien that will be outOfBounds in the x axis and if so tells the whole group
         const shift = s.aliens.aliensList.reduce((acc: boolean, b: Body) => acc || outOfBoundsX(b), false)
         // Checks if it is time for the aliens to move
         const timeToMove = (s.time - s.aliens.timeSinceLastMove) >= s.aliens.timeBetweenMoves
         return <AlienGroup>{
            ...s.aliens,
            // If it is time to move, check whether they need to move down, if so set the velocities for the aliens to move down else let the aliens keep moving in the direction
            aliensList: timeToMove ? shift ? s.aliens.aliensList.map((b: Body) => <Body>{ ...b, xvel: 0, yvel: 40 }).map(updateBody) : s.aliens.aliensList.map((b: Body) => <Body>{ ...b, xvel: 10 * s.aliens.direction, yvel: 0 }).map(updateBody) : s.aliens.aliensList,
            timeSinceLastMove: timeToMove ? s.time : s.aliens.timeSinceLastMove,
            // Checks if the aliens need to move down if so flip the alien direction
            direction: timeToMove && shift ? s.aliens.direction * -1 : s.aliens.direction,
            // Set the time between moves to the amount of aliens left * 3 so that as more aliens die the aliens will increase in speed
            timeBetweenMoves: (s.aliens.aliensList.length) * 3
         }
      },

      newAlienBullet = (s: State) => {
         // Finds the closest alien that will be the one shooting the bullet
         const closestAlien = s.aliens.aliensList.reduce((closest: Body, current: Body) => alienDistance([s.shipData.ship, closest]) > alienDistance([s.shipData.ship, current]) ? current : closest, s.aliens.aliensList[0])
         // The alien then has a .5% + .1% * level chance to shoot
         return s.aliens.aliensList.length > 0 && nextRandom() > 0.995 - 0.001 * s.level ? [createBullet(nextRandom())(closestAlien)(CONSTANTS.BULLET_VELOCITY)(CONSTANTS.BULLET_HEIGHT)(CONSTANTS.BULLET_WIDTH)] : []
      },

      newPlayerBullet = (s: State) => {
         const
            // Create a base bullet with a randomID at the ships location with a certain velocity
            baseBullet = createBullet(nextRandom())(s.shipData.ship)(-CONSTANTS.BULLET_VELOCITY),
            // Calculate the height and width for the custom bullet if there is one
            bulletHeight = s.shipData.bulletQueue[0] === 'Pierce' ? 545 : 'Wide' ? 12 : 0,
            bulletWidth = s.shipData.bulletQueue[0] === 'Pierce' ? 3 : 'Wide' ? 90 : 0
         return <ShipData>{
            ...s.shipData,
            // Remove the first bullet in the queue if there is one as it has just been used
            bulletQueue: s.shipData.bulletQueue.slice(1),
            // If there is a custom bullet in the queue use that custom bullets height and width else just deafult to the basic bullet
            bullet: s.shipData.bulletQueue.length > 0 ? s.shipData.bullet.concat([baseBullet(bulletHeight)(bulletWidth)]) : s.shipData.bullet.concat([baseBullet(CONSTANTS.BULLET_HEIGHT)(CONSTANTS.BULLET_WIDTH)]),
         }
      },

      tick = (s: State, elapsed: number) => {
         // If the game is over do nothing and put all the aliens to be removed so the Game Over screen can be seen clearer
         return s.gameOver ?
            { ...s, exit: s.aliens.aliensList } :
            // Otherwise handle the collisions of the state
            handleCollision(<State>{
               ...s,
               // Update all bodies and groups of bodies
               shipData: updateShipData(s),
               bullets: s.bullets.concat(newAlienBullet(s)).map(updateBody),
               // If the aliensList is empty then all aliens must be dead so go to next level by respawning aliens, regenerating shields and incrementing the level counter
               aliens: s.aliens.aliensList.length < 1 ? createAlienGroup(s.level + 1) : updateAlienGroup(s),
               shields: s.aliens.aliensList.length < 1 ? createShield() : s.shields,
               level: s.aliens.aliensList.length < 1 ? s.level + 1 : s.level,
               time: elapsed,
               // If the ship has no more lives then gameOver
               gameOver: s.shipData.lives <= 0
            })
      },

      // Function that purchases a powerup, it takes in the state, the point cost and the effect the powerup has and checks that the player has enough points
      purchasePowerup = (s: State) => (pointCost: number) => (effect: (s: State) => State) =>
         s.points >= pointCost ? effect({ ...s, points: s.points - pointCost }) : s,

      // Regenerates the shields
      regenerateShieldsEffect = (s: State) => {
         return <State>{
            ...s,
            shields: createShield()
         }
      },

      // Gives an extra life
      extraLifeEffect = (s: State) => {
         return <State>{
            ...s,
            shipData: { ...s.shipData, lives: s.shipData.lives + 1 }
         }
      },

      // Adds a customBullet to the bullet queue
      purchaseBulletEffect = (b: BulletType) => (s: State) => {
         return <State>{
            ...s,
            shipData: { ...s.shipData, bulletQueue: s.shipData.bulletQueue.concat([b]) }
         }
      },


      reduceState = (s: State, e: Move | Tick | Reset | RegenerateShields | ExtraLife | CustomBullet) =>
         // If it is a move then change the ships x velocity 
         e instanceof Move ? {
            ...s,
            shipData: { ...s.shipData, ship: { ...s.shipData.ship, xvel: e.direction } }
         } :
         // If it is a shoot check that the ship doesn't have too many bullets active and then call the newPlayerBullet function to make a new bullet
         e instanceof Shoot ? {
            ...s,
            shipData: s.shipData.bulletActive ? s.shipData : newPlayerBullet(s)
         } :
         // If it is a reset create the intial state again with all current bodies in the exit array
         e instanceof Reset ?
            createInitialState([].concat(s.bullets, s.shipData.bullet)) :
         // For the following powerups call the purchasePowerupFunction with the corresponding cost and effect
         e instanceof RegenerateShields ?
            purchasePowerup(s)(CONSTANTS.SHIELD_COST)(regenerateShieldsEffect) :
         e instanceof ExtraLife ?
            purchasePowerup(s)(CONSTANTS.LIFE_COST)(extraLifeEffect) :
         e instanceof CustomBullet ?
            purchasePowerup(s)(CONSTANTS.BULLET_COST)(purchaseBulletEffect(e.bulletType)) :
         tick(s, e.elapsed)

   // Main game stream
   const subscription =
      merge(gameClock,
         startMoveRight, startMoveLeft,
         stopMoveRight, stopMoveLeft,
         shoot,
         reset,
         regenerateShields,
         extraLife,
         pierceBullet, wideBullet)
         .pipe(
            scan(reduceState, initalState))
         .subscribe(updateView)

   function updateView(s: State) {
      const
         // Get all elements that may need to be changed
         svg = document.getElementById('canvas'),
         pointCounter = document.getElementById('pointCounter'),
         levelNumber = document.getElementById('levelNumber'),
         livesCounter = document.getElementById('livesCounter'),
         gameOverText = document.getElementById('gameover'),

         // Updates the Body View derived from FRP Asteroids
         updateBodyView = (b: Body) => {
            function createBodyView() {
               const v = document.createElementNS(svg.namespaceURI, "rect");
               v.setAttribute('id', `${b.id}`);
               v.setAttribute('height', `${b.height}`)
               v.setAttribute('width', `${b.width}`)
               isNotNullOrUndefined(b.color) ? v.setAttribute('fill', b.color) : v.setAttribute('fill', 'white')
               svg.appendChild(v);
               return v;
            }
            const v = document.getElementById(b.id) || createBodyView()
            v.setAttribute('transform', `translate(${b.xpos},${b.ypos})`)


         }

      // Update all the bodies in the game
      updateBodyView(s.shipData.ship)
      s.shipData.bullet.forEach(updateBodyView)
      s.bullets.forEach(updateBodyView)
      s.aliens.aliensList.forEach(updateBodyView)
      s.shields.forEach(updateBodyView)

      // Update all the text counters
      pointCounter.textContent = `Points: ${s.points}`
      levelNumber.textContent = `Level: ${s.level + 1}`
      livesCounter.textContent = `Lives: ${s.shipData.lives}`

      // Taken from FRP asteroids
      s.exit.map(o => document.getElementById(o.id))
         .filter(isNotNullOrUndefined)
         .forEach(v => {
            try {
               svg.removeChild(v)
            } catch (e) {
               // rarely it can happen that a bullet can be in exit 
               // for both expiring and colliding in the same tick,
               // which will cause this exception
               console.log("Already removed: " + v.id)
            }
         })

      if (s.gameOver) {
         gameOverText.textContent = "Game Over";
      } else {
         gameOverText.textContent = "";
      }
   }
}



// the following simply runs your pong function on window load.  Make sure to leave it in place.
if (typeof window != 'undefined')
   window.onload = () => {
      spaceinvaders();
   }


// Taken from FRP Asteroids
/**
 * apply f to every element of a and return the result in a flat array
 * @param a an array
 * @param f a function that produces an array
 */
function flatMap<T, U>(
   a: ReadonlyArray<T>,
   f: (a: T) => ReadonlyArray<U>
): ReadonlyArray<U> {
   return Array.prototype.concat(...a.map(f));
}
const
   /**
    * Composable not: invert boolean result of given function
    * @param f a function returning boolean
    * @param x the value that will be tested with f
    */
   not = <T>(f: (x: T) => boolean) => (x: T) => !f(x),
   /**
    * is e an element of a using the eq function to test equality?
    * @param eq equality test function for two Ts
    * @param a an array that will be searched
    * @param e an element to search a for
    */
   elem =
      <T>(eq: (_: T) => (_: T) => boolean) =>
         (a: ReadonlyArray<T>) =>
            (e: T) => a.findIndex(eq(e)) >= 0,
   /**
    * array a except anything in b
    * @param eq equality test function for two Ts
    * @param a array to be filtered
    * @param b array of elements to be filtered out of a
    */
   except =
      <T>(eq: (_: T) => (_: T) => boolean) =>
         (a: ReadonlyArray<T>) =>
            (b: ReadonlyArray<T>) => a.filter(not(elem(eq)(b)))

function isNotNullOrUndefined<T extends Object>(input: null | undefined | T): input is T {
   return input != null;
}

// Taken from week 4 tutorial
class RNG {
   // LCG using GCC's constants
   m = 0x80000000// 2**31
   a = 1103515245
   c = 12345
   state: number
   constructor(seed) {
      this.state = seed ? seed : Math.floor(Math.random() * (this.m - 1));
   }
   nextInt() {
      this.state = (this.a * this.state + this.c) % this.m;
      return this.state;
   }
   nextFloat() {
      // returns in range [0,1]
      return this.nextInt() / (this.m - 1);
   }
}