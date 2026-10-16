// CALEND: the game board / town map and calendar (port in ../calend/).
import type { MovieFactory } from '../context.ts';
import { Calend } from '../calend/board.ts';

const factory: MovieFactory = (c) => new Calend(c).module();
export default factory;
