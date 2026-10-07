import UniformBuffer from './UniformBuffer.js';
import { GPU_CHUNK_BYTES } from './Constants.js';
import { error } from '../../utils.js';

// uniform type codes of the update plan, see UniformsGroup#_buildUpdatePlan()

const NUMBER = 0;
const VECTOR2 = 1;
const VECTOR3 = 2;
const VECTOR4 = 3;
const COLOR = 4;
const MATRIX3 = 5;
const MATRIX4 = 6;
const UNSUPPORTED = 7;

/**
 * This class represents a uniform buffer binding but with
 * an API that allows to maintain individual uniform objects.
 *
 * @private
 * @augments UniformBuffer
 */
class UniformsGroup extends UniformBuffer {

	/**
	 * Constructs a new uniforms group.
	 *
	 * @param {string} name - The group's name.
	 */
	constructor( name ) {

		super( name );

		/**
		 * This flag can be used for type testing.
		 *
		 * @type {boolean}
		 * @readonly
		 * @default true
		 */
		this.isUniformsGroup = true;

		/**
		 * An array with the raw uniform values.
		 *
		 * @private
		 * @type {?Array<number>}
		 * @default null
		 */
		this._values = null;

		/**
		 * Cached integer views of the buffer, see `_getBufferForType()`.
		 *
		 * @private
		 * @type {?Int32Array}
		 * @default null
		 */
		this._bufferInt32 = null;

		/**
		 * @private
		 * @type {?Uint32Array}
		 * @default null
		 */
		this._bufferUint32 = null;

		/**
		 * An array of uniform objects.
		 *
		 * The order of uniforms in this array must match the order of uniforms in the shader.
		 *
		 * @type {Array<Uniform>}
		 */
		this.uniforms = [];

		/**
		 * Per-uniform update range objects, indexed by uniform index.
		 *
		 * @private
		 * @type {Array<{start: number, count: number}>}
		 */
		this._rangeObjects = [];

		/**
		 * Per-uniform marker: equals `_rangeEpoch` if the uniform's range has already been
		 * pushed into `updateRanges` during the current update cycle.
		 *
		 * @private
		 * @type {?Uint32Array}
		 * @default null
		 */
		this._rangeMarks = null;

		/**
		 * The current update cycle, incremented by `clearUpdateRanges()`.
		 *
		 * @private
		 * @type {number}
		 * @default 1
		 */
		this._rangeEpoch = 1;

		/**
		 * The update plan (type codes, offsets and value sources of all uniforms) used by
		 * `update()`. It is rebuilt when uniforms are added or removed or the layout is recomputed.
		 *
		 * @private
		 * @type {?Object}
		 * @default null
		 */
		this._updatePlan = null;

	}

	/**
	 * Adds a uniform's update range to this buffer.
	 *
	 * @param {Uniform} uniform - The uniform.
	 */
	addUniformUpdateRange( uniform ) {

		this._addRange( uniform.index, uniform.offset, uniform.itemSize );

	}

	/**
	 * Adds the update range of the uniform at the given index, at most once per update cycle.
	 *
	 * @private
	 * @param {number} index - The uniform index.
	 * @param {number} start - The range start (uniform offset).
	 * @param {number} count - The range length (uniform item size).
	 */
	_addRange( index, start, count ) {

		let marks = this._rangeMarks;

		if ( marks === null || index >= marks.length ) {

			const grown = new Uint32Array( Math.max( index + 1, this.uniforms.length ) );
			if ( marks !== null ) grown.set( marks );
			marks = this._rangeMarks = grown;

		}

		if ( marks[ index ] === this._rangeEpoch ) return;

		marks[ index ] = this._rangeEpoch;

		let range = this._rangeObjects[ index ];

		if ( range === undefined ) {

			range = { start: 0, count: 0 };
			this._rangeObjects[ index ] = range;

		}

		range.start = start;
		range.count = count;

		this.updateRanges.push( range );

	}

	/**
	 * Clears all update ranges of this buffer.
	 */
	clearUpdateRanges() {

		this._rangeEpoch ++;

		if ( this._rangeEpoch === 0xffffffff ) {

			this._rangeEpoch = 1;
			if ( this._rangeMarks !== null ) this._rangeMarks.fill( 0 );

		}

		super.clearUpdateRanges();

	}

	/**
	 * Adds a uniform to this group.
	 *
	 * @param {Uniform} uniform - The uniform to add.
	 * @return {UniformsGroup} A reference to this group.
	 */
	addUniform( uniform ) {

		this.uniforms.push( uniform );

		this._updatePlan = null;

		return this;

	}

	/**
	 * Removes a uniform from this group.
	 *
	 * @param {Uniform} uniform - The uniform to remove.
	 * @return {UniformsGroup} A reference to this group.
	 */
	removeUniform( uniform ) {

		const index = this.uniforms.indexOf( uniform );

		if ( index !== - 1 ) {

			this.uniforms.splice( index, 1 );

			this._updatePlan = null;

		}

		return this;

	}

	/**
	 * An array with the raw uniform values.
	 *
	 * @type {Array<number>}
	 */
	get values() {

		if ( this._values === null ) {

			this._values = Array.from( this.buffer );

		}

		return this._values;

	}

	/**
	 * A Float32 array buffer with the uniform values.
	 *
	 * @type {Float32Array}
	 */
	get buffer() {

		let buffer = this._buffer;

		if ( buffer === null ) {

			const byteLength = this.byteLength;

			buffer = new Float32Array( new ArrayBuffer( byteLength ) );

			this._buffer = buffer;

		}

		return buffer;

	}

	/**
	 * The byte length of the buffer with correct buffer alignment.
	 *
	 * @type {number}
	 */
	get byteLength() {

		const bytesPerElement = this.bytesPerElement;

		let offset = 0; // global buffer offset in bytes

		for ( let i = 0, l = this.uniforms.length; i < l; i ++ ) {

			const uniform = this.uniforms[ i ];

			const boundary = uniform.boundary;
			const itemSize = uniform.itemSize * bytesPerElement; // size of the uniform in bytes

			const chunkOffset = offset % GPU_CHUNK_BYTES; // offset in the current chunk
			const chunkPadding = chunkOffset % boundary; // required padding to match boundary
			const chunkStart = chunkOffset + chunkPadding; // start position in the current chunk for the data

			offset += chunkPadding;

			// Check for chunk overflow
			if ( chunkStart !== 0 && ( GPU_CHUNK_BYTES - chunkStart ) < itemSize ) {

				// Add padding to the end of the chunk
				offset += ( GPU_CHUNK_BYTES - chunkStart );

			}

			uniform.offset = offset / bytesPerElement;
			uniform.index = i;

			offset += itemSize;

		}

		this._updatePlan = null; // offsets may have changed

		return Math.ceil( offset / GPU_CHUNK_BYTES ) * GPU_CHUNK_BYTES;

	}

	/**
	 * Updates this group by updating each uniform object of
	 * the internal uniform list. The uniform objects check if their
	 * values has actually changed so this method only returns
	 * `true` if there is a real value change.
	 *
	 * @return {boolean} Whether the uniforms have been updated and
	 * must be uploaded to the GPU.
	 */
	update() {

		if ( this.uniforms.length === 0 ) return false;

		const a = this.values; // also computes the layout (offsets) if required

		const plan = this._updatePlan !== null ? this._updatePlan : this._buildUpdatePlan();
		const { types, offsets, sources } = plan;
		const uniforms = this.uniforms;

		let updated = false;

		for ( let i = 0, l = types.length; i < l; i ++ ) {

			const uniform = uniforms[ i ];
			const source = sources[ i ];
			const offset = offsets[ i ];

			let result;

			switch ( types[ i ] ) {

				case NUMBER: result = this._updateNumber( a, uniform, i, offset, source !== null ? source.value : uniform.getValue() ); break;
				case VECTOR2: result = this._updateVector2( a, uniform, i, offset, source !== null ? source.value : uniform.getValue() ); break;
				case VECTOR3: result = this._updateVector3( a, uniform, i, offset, source !== null ? source.value : uniform.getValue() ); break;
				case VECTOR4: result = this._updateVector4( a, uniform, i, offset, source !== null ? source.value : uniform.getValue() ); break;
				case COLOR: result = this._updateColor( a, i, offset, source !== null ? source.value : uniform.getValue() ); break;
				case MATRIX3: result = this._updateMatrix3( a, i, offset, ( source !== null ? source.value : uniform.getValue() ).elements ); break;
				case MATRIX4: result = this._updateMatrix4( a, i, offset, ( source !== null ? source.value : uniform.getValue() ).elements ); break;
				default: result = this.updateByType( uniform );

			}

			if ( result === true ) updated = true;

		}

		return updated;

	}

	/**
	 * Builds the update plan: monomorphic arrays with the type code and offset of each uniform
	 * and, for node uniforms, the node uniform to read the value from. Reading these instead of
	 * the properties of the (differently shaped) uniform objects keeps `update()` fast.
	 *
	 * @private
	 * @return {Object} The update plan.
	 */
	_buildUpdatePlan() {

		const uniforms = this.uniforms;
		const count = uniforms.length;

		const types = new Uint8Array( count );
		const offsets = new Uint32Array( count );
		const sources = new Array( count );

		for ( let i = 0; i < count; i ++ ) {

			const uniform = uniforms[ i ];

			let type = UNSUPPORTED;

			if ( uniform.isNumberUniform ) type = NUMBER;
			else if ( uniform.isVector2Uniform ) type = VECTOR2;
			else if ( uniform.isVector3Uniform ) type = VECTOR3;
			else if ( uniform.isVector4Uniform ) type = VECTOR4;
			else if ( uniform.isColorUniform ) type = COLOR;
			else if ( uniform.isMatrix3Uniform ) type = MATRIX3;
			else if ( uniform.isMatrix4Uniform ) type = MATRIX4;

			// the index is used for update ranges and must match the uniform's index

			if ( uniform.index !== i ) type = UNSUPPORTED;

			types[ i ] = type;
			offsets[ i ] = uniform.offset;

			// node uniform wrappers return `nodeUniform.value` from getValue()

			const nodeUniform = uniform.nodeUniform;
			sources[ i ] = ( nodeUniform !== undefined && nodeUniform !== null && nodeUniform.isNodeUniform === true ) ? nodeUniform : null;

		}

		this._updatePlan = { types, offsets, sources };

		return this._updatePlan;

	}

	/**
	 * Releases the buffer.
	 */
	release() {

		super.release();

		this._values = null;
		this._bufferInt32 = null;
		this._bufferUint32 = null;

	}

	/**
	 * Updates a given uniform by calling an update method matching
	 * the uniforms type.
	 *
	 * @param {Uniform} uniform - The uniform to update.
	 * @return {boolean} Whether the uniform has been updated or not.
	 */
	updateByType( uniform ) {

		if ( uniform.isNumberUniform ) return this.updateNumber( uniform );
		if ( uniform.isVector2Uniform ) return this.updateVector2( uniform );
		if ( uniform.isVector3Uniform ) return this.updateVector3( uniform );
		if ( uniform.isVector4Uniform ) return this.updateVector4( uniform );
		if ( uniform.isColorUniform ) return this.updateColor( uniform );
		if ( uniform.isMatrix3Uniform ) return this.updateMatrix3( uniform );
		if ( uniform.isMatrix4Uniform ) return this.updateMatrix4( uniform );

		error( 'WebGPUUniformsGroup: Unsupported uniform type.', uniform );

	}

	/**
	 * Updates a given Number uniform.
	 *
	 * @param {NumberUniform} uniform - The Number uniform.
	 * @return {boolean} Whether the uniform has been updated or not.
	 */
	updateNumber( uniform ) {

		return this._updateNumber( this.values, uniform, uniform.index, uniform.offset, uniform.getValue() );

	}

	/**
	 * @private
	 * @param {Array<number>} a - The raw uniform values.
	 * @param {Uniform} uniform - The uniform.
	 * @param {number} index - The uniform index.
	 * @param {number} offset - The uniform offset.
	 * @param {number} v - The uniform value.
	 * @return {boolean} Whether the uniform has been updated or not.
	 */
	_updateNumber( a, uniform, index, offset, v ) {

		if ( a[ offset ] !== v ) {

			const b = this._getBufferForType( uniform.getType() );

			b[ offset ] = a[ offset ] = v;

			this._addRange( index, offset, 1 );

			return true;

		}

		return false;

	}

	/**
	 * Updates a given Vector2 uniform.
	 *
	 * @param {Vector2Uniform} uniform - The Vector2 uniform.
	 * @return {boolean} Whether the uniform has been updated or not.
	 */
	updateVector2( uniform ) {

		return this._updateVector2( this.values, uniform, uniform.index, uniform.offset, uniform.getValue() );

	}

	/**
	 * @private
	 * @param {Array<number>} a - The raw uniform values.
	 * @param {Uniform} uniform - The uniform.
	 * @param {number} index - The uniform index.
	 * @param {number} offset - The uniform offset.
	 * @param {Object} v - The uniform value.
	 * @return {boolean} Whether the uniform has been updated or not.
	 */
	_updateVector2( a, uniform, index, offset, v ) {

		if ( a[ offset + 0 ] !== v.x || a[ offset + 1 ] !== v.y ) {

			const b = this._getBufferForType( uniform.getType() );

			b[ offset + 0 ] = a[ offset + 0 ] = v.x;
			b[ offset + 1 ] = a[ offset + 1 ] = v.y;

			this._addRange( index, offset, 2 );

			return true;

		}

		return false;

	}

	/**
	 * Updates a given Vector3 uniform.
	 *
	 * @param {Vector3Uniform} uniform - The Vector3 uniform.
	 * @return {boolean} Whether the uniform has been updated or not.
	 */
	updateVector3( uniform ) {

		return this._updateVector3( this.values, uniform, uniform.index, uniform.offset, uniform.getValue() );

	}

	/**
	 * @private
	 * @param {Array<number>} a - The raw uniform values.
	 * @param {Uniform} uniform - The uniform.
	 * @param {number} index - The uniform index.
	 * @param {number} offset - The uniform offset.
	 * @param {Object} v - The uniform value.
	 * @return {boolean} Whether the uniform has been updated or not.
	 */
	_updateVector3( a, uniform, index, offset, v ) {

		if ( a[ offset + 0 ] !== v.x || a[ offset + 1 ] !== v.y || a[ offset + 2 ] !== v.z ) {

			const b = this._getBufferForType( uniform.getType() );

			b[ offset + 0 ] = a[ offset + 0 ] = v.x;
			b[ offset + 1 ] = a[ offset + 1 ] = v.y;
			b[ offset + 2 ] = a[ offset + 2 ] = v.z;

			this._addRange( index, offset, 3 );

			return true;

		}

		return false;

	}

	/**
	 * Updates a given Vector4 uniform.
	 *
	 * @param {Vector4Uniform} uniform - The Vector4 uniform.
	 * @return {boolean} Whether the uniform has been updated or not.
	 */
	updateVector4( uniform ) {

		return this._updateVector4( this.values, uniform, uniform.index, uniform.offset, uniform.getValue() );

	}

	/**
	 * @private
	 * @param {Array<number>} a - The raw uniform values.
	 * @param {Uniform} uniform - The uniform.
	 * @param {number} index - The uniform index.
	 * @param {number} offset - The uniform offset.
	 * @param {Object} v - The uniform value.
	 * @return {boolean} Whether the uniform has been updated or not.
	 */
	_updateVector4( a, uniform, index, offset, v ) {

		if ( a[ offset + 0 ] !== v.x || a[ offset + 1 ] !== v.y || a[ offset + 2 ] !== v.z || a[ offset + 3 ] !== v.w ) {

			const b = this._getBufferForType( uniform.getType() );

			b[ offset + 0 ] = a[ offset + 0 ] = v.x;
			b[ offset + 1 ] = a[ offset + 1 ] = v.y;
			b[ offset + 2 ] = a[ offset + 2 ] = v.z;
			b[ offset + 3 ] = a[ offset + 3 ] = v.w;

			this._addRange( index, offset, 4 );

			return true;

		}

		return false;

	}

	/**
	 * Updates a given Color uniform.
	 *
	 * @param {ColorUniform} uniform - The Color uniform.
	 * @return {boolean} Whether the uniform has been updated or not.
	 */
	updateColor( uniform ) {

		return this._updateColor( this.values, uniform.index, uniform.offset, uniform.getValue() );

	}

	/**
	 * @private
	 * @param {Array<number>} a - The raw uniform values.
	 * @param {number} index - The uniform index.
	 * @param {number} offset - The uniform offset.
	 * @param {Color} c - The uniform value.
	 * @return {boolean} Whether the uniform has been updated or not.
	 */
	_updateColor( a, index, offset, c ) {

		if ( a[ offset + 0 ] !== c.r || a[ offset + 1 ] !== c.g || a[ offset + 2 ] !== c.b ) {

			const b = this.buffer;

			b[ offset + 0 ] = a[ offset + 0 ] = c.r;
			b[ offset + 1 ] = a[ offset + 1 ] = c.g;
			b[ offset + 2 ] = a[ offset + 2 ] = c.b;

			this._addRange( index, offset, 3 );

			return true;

		}

		return false;

	}

	/**
	 * Updates a given Matrix3 uniform.
	 *
	 * @param {Matrix3Uniform} uniform - The Matrix3 uniform.
	 * @return {boolean} Whether the uniform has been updated or not.
	 */
	updateMatrix3( uniform ) {

		return this._updateMatrix3( this.values, uniform.index, uniform.offset, uniform.getValue().elements );

	}

	/**
	 * @private
	 * @param {Array<number>} a - The raw uniform values.
	 * @param {number} index - The uniform index.
	 * @param {number} offset - The uniform offset.
	 * @param {Array<number>} e - The matrix elements.
	 * @return {boolean} Whether the uniform has been updated or not.
	 */
	_updateMatrix3( a, index, offset, e ) {

		if ( a[ offset + 0 ] !== e[ 0 ] || a[ offset + 1 ] !== e[ 1 ] || a[ offset + 2 ] !== e[ 2 ] ||
			a[ offset + 4 ] !== e[ 3 ] || a[ offset + 5 ] !== e[ 4 ] || a[ offset + 6 ] !== e[ 5 ] ||
			a[ offset + 8 ] !== e[ 6 ] || a[ offset + 9 ] !== e[ 7 ] || a[ offset + 10 ] !== e[ 8 ] ) {

			const b = this.buffer;

			b[ offset + 0 ] = a[ offset + 0 ] = e[ 0 ];
			b[ offset + 1 ] = a[ offset + 1 ] = e[ 1 ];
			b[ offset + 2 ] = a[ offset + 2 ] = e[ 2 ];
			b[ offset + 4 ] = a[ offset + 4 ] = e[ 3 ];
			b[ offset + 5 ] = a[ offset + 5 ] = e[ 4 ];
			b[ offset + 6 ] = a[ offset + 6 ] = e[ 5 ];
			b[ offset + 8 ] = a[ offset + 8 ] = e[ 6 ];
			b[ offset + 9 ] = a[ offset + 9 ] = e[ 7 ];
			b[ offset + 10 ] = a[ offset + 10 ] = e[ 8 ];

			this._addRange( index, offset, 12 );

			return true;

		}

		return false;

	}

	/**
	 * Updates a given Matrix4 uniform.
	 *
	 * @param {Matrix4Uniform} uniform - The Matrix4 uniform.
	 * @return {boolean} Whether the uniform has been updated or not.
	 */
	updateMatrix4( uniform ) {

		return this._updateMatrix4( this.values, uniform.index, uniform.offset, uniform.getValue().elements );

	}

	/**
	 * @private
	 * @param {Array<number>} a - The raw uniform values.
	 * @param {number} index - The uniform index.
	 * @param {number} offset - The uniform offset.
	 * @param {Array<number>} e - The matrix elements.
	 * @return {boolean} Whether the uniform has been updated or not.
	 */
	_updateMatrix4( a, index, offset, e ) {

		if ( arraysEqual( a, e, offset ) === false ) {

			const b = this.buffer;
			b.set( e, offset );
			setArray( a, e, offset );

			this._addRange( index, offset, 16 );

			return true;

		}

		return false;

	}

	/**
	 * Returns a typed array that matches the given data type.
	 *
	 * @private
	 * @param {string} type - The data type.
	 * @return {TypedArray} The typed array.
	 */
	_getBufferForType( type ) {

		if ( type === 'int' || type === 'ivec2' || type === 'ivec3' || type === 'ivec4' ) {

			const buffer = this.buffer.buffer;

			if ( this._bufferInt32 === null || this._bufferInt32.buffer !== buffer ) this._bufferInt32 = new Int32Array( buffer );

			return this._bufferInt32;

		}

		if ( type === 'uint' || type === 'uvec2' || type === 'uvec3' || type === 'uvec4' ) {

			const buffer = this.buffer.buffer;

			if ( this._bufferUint32 === null || this._bufferUint32.buffer !== buffer ) this._bufferUint32 = new Uint32Array( buffer );

			return this._bufferUint32;

		}

		return this.buffer;

	}

}

/**
 * Sets the values of the second array to the first array.
 *
 * @private
 * @param {TypedArray} a - The first array.
 * @param {TypedArray} b - The second array.
 * @param {number} offset - An index offset for the first array.
 */
function setArray( a, b, offset ) {

	for ( let i = 0, l = b.length; i < l; i ++ ) {

		a[ offset + i ] = b[ i ];

	}

}

/**
 * Returns `true` if the given arrays are equal.
 *
 * @private
 * @param {TypedArray} a - The first array.
 * @param {TypedArray} b - The second array.
 * @param {number} offset - An index offset for the first array.
 * @return {boolean} Whether the given arrays are equal or not.
 */
function arraysEqual( a, b, offset ) {

	for ( let i = 0, l = b.length; i < l; i ++ ) {

		if ( a[ offset + i ] !== b[ i ] ) return false;

	}

	return true;

}

export default UniformsGroup;
