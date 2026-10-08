import DataMap from './DataMap.js';
import { AttributeType } from './Constants.js';

import { Uint16BufferAttribute, Uint32BufferAttribute } from '../../core/BufferAttribute.js';

/**
 * Returns the wireframe version for the given geometry.
 *
 * @private
 * @function
 * @param {BufferGeometry} geometry - The geometry.
 * @return {number} The version.
 */
function getWireframeVersion( geometry ) {

	return ( geometry.index !== null ) ? geometry.index.version : geometry.attributes.position.version;

}

/**
 * Returns the wireframe ID for the given geometry.
 *
 * @private
 * @function
 * @param {BufferGeometry} geometry - The geometry.
 * @return {number} The ID.
 */
function getWireframeId( geometry ) {

	return ( geometry.index !== null ) ? geometry.index.id : geometry.attributes.position.id;

}

/**
 * Returns a wireframe index attribute for the given geometry.
 *
 * @private
 * @function
 * @param {BufferGeometry} geometry - The geometry.
 * @return {BufferAttribute} The wireframe index attribute.
 */
function getWireframeIndex( geometry ) {

	const indices = [];

	const geometryIndex = geometry.index;
	const geometryPosition = geometry.attributes.position;

	if ( geometryIndex !== null ) {

		const array = geometryIndex.array;

		for ( let i = 0, l = array.length; i < l; i += 3 ) {

			const a = array[ i + 0 ];
			const b = array[ i + 1 ];
			const c = array[ i + 2 ];

			indices.push( a, b, b, c, c, a );

		}

	} else {

		const array = geometryPosition.array;

		for ( let i = 0, l = ( array.length / 3 ) - 1; i < l; i += 3 ) {

			const a = i + 0;
			const b = i + 1;
			const c = i + 2;

			indices.push( a, b, b, c, c, a );

		}

	}

	const attribute = new ( geometryPosition.count >= 65535 ? Uint32BufferAttribute : Uint16BufferAttribute )( indices, 1 );
	attribute.version = getWireframeVersion( geometry );
	attribute.__id = getWireframeId( geometry );

	return attribute;

}

/**
 * This renderer module manages geometries.
 *
 * @private
 * @augments DataMap
 */
class Geometries extends DataMap {

	/**
	 * Constructs a new geometry management component.
	 *
	 * @param {Attributes} attributes - Renderer component for managing attributes.
	 * @param {Info} info - Renderer component for managing metrics and monitoring data.
	 */
	constructor( attributes, info ) {

		super();

		/**
		 * Renderer component for managing attributes.
		 *
		 * @type {Attributes}
		 */
		this.attributes = attributes;

		/**
		 * Renderer component for managing metrics and monitoring data.
		 *
		 * @type {Info}
		 */
		this.info = info;

		/**
		 * Weak Map for managing attributes for wireframe rendering.
		 *
		 * @type {WeakMap<BufferGeometry,BufferAttribute>}
		 */
		this.wireframes = new WeakMap();

		/**
		 * This Weak Map is used to make sure buffer attributes are
		 * updated only once per render call.
		 *
		 * @type {WeakMap<BufferAttribute,number>}
		 */
		this.attributeCall = new WeakMap();

		/**
		 * Weak references to the initialized geometries, used to remove
		 * the dispose listeners attached to them in {@link Geometries#dispose}.
		 * The geometries are not kept alive by the renderer.
		 *
		 * @private
		 * @type {Set<WeakRef<BufferGeometry>>}
		 */
		this._geometryRefs = new Set();

		/**
		 * Updates the bookkeeping of geometries that were garbage collected
		 * without being disposed. Their GPU data is released with them.
		 *
		 * @private
		 * @type {FinalizationRegistry<WeakRef<BufferGeometry>>}
		 */
		this._geometryRegistry = new FinalizationRegistry( ( geometryRef ) => {

			this._geometryRefs.delete( geometryRef );

			this.info.memory.geometries --;

		} );

	}

	/**
	 * Returns `true` if the given render object has an initialized geometry.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 * @return {boolean} Whether if the given render object has an initialized geometry or not.
	 */
	has( renderObject ) {

		const geometry = renderObject.geometry;

		return super.has( geometry ) && this.get( geometry ).initialized === true;

	}

	/**
	 * Prepares the geometry of the given render object for rendering.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 */
	updateForRender( renderObject ) {

		if ( this.has( renderObject ) === false ) this.initGeometry( renderObject );

		this.updateAttributes( renderObject );

	}

	/**
	 * Initializes the geometry of the given render object.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 */
	initGeometry( renderObject ) {

		const geometry = renderObject.geometry;
		const geometryData = this.get( geometry );

		geometryData.initialized = true;

		this.info.memory.geometries ++;

		// the attributes are captured instead of the render object: the listener lives as long as the
		// (possibly shared) geometry, and a render object reference would retain its object, scene and camera

		const renderObjectAttributes = renderObject.getAttributes();

		const onDispose = () => {

			this.info.memory.geometries --;

			// index

			const index = geometry.index;

			if ( index !== null ) {

				this.attributes.delete( index );

			}

			// geometry attributes

			for ( const attribute of Object.values( geometry.attributes ) ) {

				this.attributes.delete( attribute );

			}

			// wireframe attributes

			const wireframeAttribute = this.wireframes.get( geometry );

			if ( wireframeAttribute !== undefined ) {

				this.attributes.delete( wireframeAttribute );

			}

			// node attributes (TODO: Remove this bit once we support BufferAttribute.dispose())

			const currentAttributes = new Set( Object.values( geometry.attributes ) );

			for ( const attribute of renderObjectAttributes ) {

				if ( currentAttributes.has( attribute ) === false ) {

					this.attributes.delete( attribute );

				}

			}

			//

			geometry.removeEventListener( 'dispose', onDispose );

			this._geometryRefs.delete( geometryRef );
			this._geometryRegistry.unregister( geometryRef );

			this.delete( geometry );

		};

		geometry.addEventListener( 'dispose', onDispose );

		// see #31798 why tracking separate remove listeners is required right now
		// TODO: Re-evaluate how onDispose() is managed in this component

		const geometryRef = new WeakRef( geometry );

		geometryData.onDispose = onDispose;

		this._geometryRefs.add( geometryRef );
		this._geometryRegistry.register( geometry, geometryRef, geometryRef );

	}

	/**
	 * Updates the geometry attributes of the given render object.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 */
	updateAttributes( renderObject ) {

		// attributes

		const attributes = renderObject.getAttributes();

		for ( const attribute of attributes ) {

			if ( attribute.isStorageBufferAttribute || attribute.isStorageInstancedBufferAttribute ) {

				this.updateAttribute( attribute, AttributeType.STORAGE );

			} else {

				this.updateAttribute( attribute, AttributeType.VERTEX );

			}

		}

		// indexes

		const index = this.getIndex( renderObject );

		if ( index !== null ) {

			this.updateAttribute( index, AttributeType.INDEX );

		}

		// indirect

		const indirect = renderObject.geometry.indirect;

		if ( indirect !== null ) {

			this.updateAttribute( indirect, AttributeType.INDIRECT );

		}

	}

	/**
	 * Updates the given attribute.
	 *
	 * @param {BufferAttribute} attribute - The attribute to update.
	 * @param {number} type - The attribute type.
	 */
	updateAttribute( attribute, type ) {

		const callId = this.info.render.calls;

		if ( ! attribute.isInterleavedBufferAttribute ) {

			if ( this.attributeCall.get( attribute ) !== callId ) {

				this.attributes.update( attribute, type );

				this.attributeCall.set( attribute, callId );

			}

		} else {

			if ( this.attributeCall.get( attribute ) === undefined ) {

				this.attributes.update( attribute, type );

				this.attributeCall.set( attribute, callId );

			} else if ( this.attributeCall.get( attribute.data ) !== callId ) {

				this.attributes.update( attribute, type );

				this.attributeCall.set( attribute.data, callId );

				this.attributeCall.set( attribute, callId );

			}

		}

	}

	/**
	 * Returns the indirect buffer attribute of the given render object.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 * @return {?BufferAttribute} The indirect attribute. `null` if no indirect drawing is used.
	 */
	getIndirect( renderObject ) {

		return renderObject.geometry.indirect;

	}

	/**
	 * Returns the byte offset into the indirect attribute buffer of the given render object.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 * @return {number} The byte offset into the indirect attribute buffer.
	 */
	getIndirectOffset( renderObject ) {

		return renderObject.geometry.indirectOffset;

	}

	/**
	 * Returns the index of the given render object's geometry. This is implemented
	 * in a method to return a wireframe index if necessary.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 * @return {?BufferAttribute} The index. Returns `null` for non-indexed geometries.
	 */
	getIndex( renderObject ) {

		const { geometry, material } = renderObject;

		let index = geometry.index;

		if ( material.wireframe === true ) {

			const wireframes = this.wireframes;

			let wireframeAttribute = wireframes.get( geometry );

			if ( wireframeAttribute === undefined ) {

				wireframeAttribute = getWireframeIndex( geometry );

				wireframes.set( geometry, wireframeAttribute );

			} else if ( wireframeAttribute.version !== getWireframeVersion( geometry ) || wireframeAttribute.__id !== getWireframeId( geometry ) ) {

				this.attributes.delete( wireframeAttribute );

				wireframeAttribute = getWireframeIndex( geometry );

				wireframes.set( geometry, wireframeAttribute );

			}

			index = wireframeAttribute;

		}

		return index;

	}

	dispose() {

		for ( const geometryRef of this._geometryRefs ) {

			const geometry = geometryRef.deref();

			if ( geometry !== undefined ) geometry.removeEventListener( 'dispose', this.get( geometry ).onDispose );

			this._geometryRegistry.unregister( geometryRef );

		}

		this._geometryRefs.clear();

	}

}

export default Geometries;
