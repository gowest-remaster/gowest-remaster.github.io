// Camera: one fixed shot per outdoor Place. A plated view uses its plate's own camera (plate.json); these authored
// shots are what the plates were rendered from (and the fallback when a plate.json has no camera). No flights, no
// drift: a plate is a fixed photograph, the live layer must stay registered to it.
import * as THREE from 'three/webgpu';
import type { Place } from './api';
import { BARN, FIELD, HOME, RAIL_Z, STREET, terrainHeight } from './env/layout';

export interface Shot {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

export function outdoorShot(place: Place, squares: number): Shot | null {
  const hy = terrainHeight(HOME.x, HOME.z);
  const pitch = FIELD.square + FIELD.gap;
  const fieldW = squares > 8 ? 4 * pitch : 2 * pitch;
  switch (place) {
    case 'title':
      return { pos: new THREE.Vector3(-30, 16 + hy, 70), look: new THREE.Vector3(8, 2 + hy, -10), fov: 38 };
    case 'homestead':
      // cozy diorama: house middle-right, windmill centre, barn right with the crops beyond, road to town on the left
      return { pos: new THREE.Vector3(2, 5.8 + terrainHeight(2, 18), 18), look: new THREE.Vector3(3, 1.2 + terrainHeight(3, -40), -40), fov: 44 };
    case 'field': {
      // a photographer on a rise south of the claim: every square in frame (8, or 16 after the 1909 claim) with room
      // for the UI's side panel and HUD, as close as that allows so each square's stage still reads
      const cx = FIELD.x0 + fieldW / 2;
      const cz = FIELD.z0 - (4 * pitch) / 2;
      const wide = squares > 8;
      const px = cx - fieldW * (wide ? 0.07 : 0.03);
      const pz = FIELD.z0 + (wide ? 330 : 270); // far back with a longer lens: less perspective spread
      return {
        pos: new THREE.Vector3(px, (wide ? 125 : 100) + terrainHeight(px, pz), pz),
        look: new THREE.Vector3(cx, terrainHeight(cx, cz), cz - pitch * 0.45),
        fov: wide ? 33 : 28,
      };
    }
    case 'pen':
      return {
        pos: new THREE.Vector3(BARN.x - 9, terrainHeight(BARN.x - 9, BARN.z + 27) + 2.6, BARN.z + 27),
        look: new THREE.Vector3(BARN.x + 2, terrainHeight(BARN.x, BARN.z + 12) + 1.3, BARN.z + 11),
        fov: 46,
      };
    case 'mainStreet':
      return {
        // elevated three-quarter crane from the street's north-east corner: bank + store fronts at an angle,
        // the street receding diagonally to the elevator, wagons seen at an angle
        pos: new THREE.Vector3(STREET.x + 17, terrainHeight(STREET.x + 17, STREET.z0 + 26) + 27, STREET.z0 + 26),
        look: new THREE.Vector3(STREET.x - 27, terrainHeight(STREET.x - 27, STREET.z0 - 67) + 1.0, STREET.z0 - 67),
        fov: 38,
      };
    case 'elevator':
      return {
        pos: new THREE.Vector3(STREET.x - 6, terrainHeight(STREET.x, RAIL_Z + 48) + 2.6, RAIL_Z + 48),
        look: new THREE.Vector3(STREET.x - 32, 9, RAIL_Z + 8),
        fov: 52,
      };
    default:
      return null;
  }
}

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  current: Shot;
  /** >1 widens the view (UI panels cover part of the screen) */
  fovScale = 1;

  constructor(camera: THREE.PerspectiveCamera, initial: Shot) {
    this.camera = camera;
    this.current = { pos: initial.pos.clone(), look: initial.look.clone(), fov: initial.fov };
  }

  set(shot: Shot): void {
    this.current = { pos: shot.pos.clone(), look: shot.look.clone(), fov: shot.fov };
  }

  update(): void {
    const cam = this.camera;
    cam.position.copy(this.current.pos);
    cam.fov = this.current.fov * this.fovScale;
    cam.updateProjectionMatrix();
    cam.lookAt(this.current.look);
    cam.updateMatrixWorld();
  }
}
