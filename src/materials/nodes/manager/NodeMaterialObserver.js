import { RenderObjectRefreshType, DynamicDrawUsage } from '../../../constants.js';
import { NodeUpdateType } from '../../../nodes/core/constants.js';

const refreshUniforms = [
	'alphaMap',
	'alphaTest',
	'anisotropy',
	'anisotropyMap',
	'anisotropyRotation',
	'aoMap',
	'aoMapIntensity',
	'attenuationColor',
	'attenuationDistance',
	'bumpMap',
	'bumpScale',
	'clearcoat',
	'clearcoatMap',
	'clearcoatNormalMap',
	'clearcoatNormalScale',
	'clearcoatRoughness',
	'color',
	'dashOffset',
	'dashSize',
	'dispersion',
	'displacementBias',
	'displacementMap',
	'displacementScale',
	'emissive',
	'emissiveIntensity',
	'emissiveMap',
	'envMap',
	'envMapIntensity',
	'envMapRotation',
	'gapSize',
	'gradientMap',
	'ior',
	'iridescence',
	'iridescenceIOR',
	'iridescenceMap',
	'iridescenceThickness',
	'iridescenceThicknessMap',
	'lightMap',
	'lightMapIntensity',
	'linewidth',
	'map',
	'matcap',
	'metalness',
	'metalnessMap',
	'normalMap',
	'normalScale',
	'opacity',
	'reflectivity',
	'retroreflectivity',
	'rotation',
	'roughness',
	'roughnessMap',
	'scale',
	'sheen',
	'sheenColor',
	'sheenColorMap',
	'sheenRoughness',
	'sheenRoughnessMap',
	'shininess',
	'size',
	'specular',
	'specularColor',
	'specularColorMap',
	'specularIntensity',
	'specularIntensityMap',
	'specularMap',
	'steps',
	'thickness',
	'transmission',
	'transmissionMap',
	'wireframe'
];


/**
 * A WeakMap to cache lights data for node materials.
 * Cache lights data by render ID to avoid unnecessary recalculations.
 *
 * @private
 * @type {WeakMap<LightsNode,Object>}
 */
const _lightsCache = new WeakMap();

/**
 * Holds the material data for comparison.
 *
 * @private
 * @type {WeakMap<Material,Object>}
 */
const _materialCache = new WeakMap();

/**
 * Holds the geometry data for comparison.
 *
 * @private
 * @type {WeakMap<BufferGeometry,Object>}
 */
const _geometryCache = new WeakMap();

/**
 * Holds the texture data for comparison.
 *
 * @private
 * @type {WeakMap<Texture,Object>}
 */
const _textureCache = new WeakMap();

/**
 * This class is used by {@link WebGPURenderer} as management component.
 * It's primary purpose is to determine whether render objects require a
 * refresh right before they are going to be rendered or not.
 */
class NodeMaterialObserver {

	/**
	 * Constructs a new node material observer.
	 *
	 * @param {NodeBuilder} builder - The node builder.
	 */
	constructor( builder ) {

		/**
		 * A node material can be used by more than one render object so the
		 * monitor must maintain a list of render objects.
		 *
		 * @type {WeakMap<RenderObject,Object>}
		 */
		this.renderObjects = new WeakMap();

		/**
		 * Whether the material uses node objects or not.
		 *
		 * @type {boolean}
		 */
		this.hasNode = this.containsNode( builder );

		/**
		 * Whether the node builder's 3D object is animated or not.
		 *
		 * @type {boolean}
		 */
		this.hasAnimation = builder.object.isSkinnedMesh === true;

		/**
		 * A list of all possible material uniforms
		 *
		 * @type {Array<string>}
		 */
		this.refreshUniforms = refreshUniforms;

		/**
		 * Holds the current render ID from the node frame.
		 *
		 * @type {number}
		 * @default 0
		 */
		this.renderId = 0;

		/**
		 * The object-scope bindings tracked for static content, see {@link NodeMaterialObserver#objectUniformsChanged}.
		 *
		 * @private
		 * @type {?Object}
		 * @default null
		 */
		this.objectUniforms = null;

		/**
		 * The render ID of the last comparison of the tracked object-scope bindings.
		 *
		 * @private
		 * @type {number}
		 * @default - 1
		 */
		this.objectUniformsRenderId = - 1;

		/**
		 * Incremented when the values of the tracked object-scope bindings change.
		 *
		 * @private
		 * @type {number}
		 * @default 0
		 */
		this.objectUniformsVersion = 0;

		/**
		 * The render ID of the last update of the nodes updated before rendering, used by
		 * the renderer when refreshing static render bundles.
		 *
		 * @private
		 * @type {number}
		 * @default - 1
		 */
		this.bundleRenderId = - 1;

		/**
		 * The render ID in which a new version of a tracked texture or storage buffer was detected.
		 * The renderer uploads it with the next render object of this observer.
		 *
		 * @private
		 * @type {number}
		 * @default - 1
		 */
		this.resourcesRenderId = - 1;

	}

	/**
	 * Returns `true` if the given render object is verified for the first time of this observer.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 * @return {boolean} Whether the given render object is verified for the first time of this observer.
	 */
	firstInitialization( renderObject ) {

		const hasInitialized = this.renderObjects.has( renderObject );

		if ( hasInitialized === false ) {

			this.getRenderObjectData( renderObject );

			return true;

		}

		return false;

	}

	/**
	 * Returns `true` if the given 3D object uses instance buffers with dynamic draw usage.
	 * Such buffers must be uploaded once per render so the render object requires a full refresh.
	 *
	 * @param {Object3D} object - The 3D object.
	 * @return {boolean} Whether the given 3D object uses instance buffers with dynamic draw usage or not.
	 */
	hasDynamicInstancing( object ) {

		return object.isInstancedMesh === true && ( object.instanceMatrix.usage === DynamicDrawUsage ||
			( object.instanceColor !== null && object.instanceColor.usage === DynamicDrawUsage ) );

	}

	/**
	 * Returns `true` if the current rendering produces motion vectors.
	 *
	 * @param {Renderer} renderer - The renderer.
	 * @return {boolean} Whether the current rendering produces motion vectors or not.
	 */
	needsVelocity( renderer ) {

		const mrt = renderer.getMRT();

		return ( mrt !== null && mrt.has( 'velocity' ) );

	}

	/**
	 * Returns monitoring data for the given render object.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 * @return {Object} The monitoring data.
	 */
	getRenderObjectData( renderObject ) {

		let data = this.renderObjects.get( renderObject );

		if ( data === undefined ) {

			const { geometry, object } = renderObject;

			data = {
				geometryId: geometry.id,
				geometryVersion: this.getGeometryData( geometry )._version,
				materialVersion: this.getMaterialData( renderObject.material )._version,
				worldMatrix: object.matrixWorld.clone()
			};

			if ( object.center ) {

				data.center = object.center.clone();

			}

			if ( object.morphTargetInfluences ) {

				data.morphTargetInfluences = object.morphTargetInfluences.slice();

			}

			if ( object.isInstancedMesh === true ) {

				data.instanceMatrixVersion = object.instanceMatrix.version;
				data.instanceColorVersion = object.instanceColor !== null ? object.instanceColor.version : null;
				data.morphTextureVersion = object.morphTexture !== null ? object.morphTexture.version : null;

			}

			if ( object.isBatchedMesh === true ) {

				data.matricesTextureVersion = object._matricesTexture.version;
				data.colorsTextureVersion = object._colorsTexture !== null ? object._colorsTexture.version : null;
				data.indirectTextureVersion = object._indirectTexture.version;

			}

			if ( renderObject.bundle !== null ) {

				data.version = renderObject.bundle.version;

			}

			// global data

			const { width, height } = renderObject.context;

			data.bufferWidth = width;
			data.bufferHeight = height;

			const { environmentIntensity, environmentRotation } = renderObject.scene;

			data.environmentIntensity = environmentIntensity;
			data.environmentRotation = environmentRotation.clone();

			data.lights = this.getLightsData( renderObject.lightsNode.getBuiltinLights(), [] );

			this.renderObjects.set( renderObject, data );

		}

		return data;

	}

	/**
	 * Returns an attribute data structure holding the attributes versions for
	 * monitoring.
	 *
	 * @param {Object} attributes - The geometry attributes.
	 * @return {Object} An object for monitoring the versions of attributes.
	 */
	getAttributesData( attributes ) {

		const attributesData = {};

		for ( const name in attributes ) {

			const attribute = attributes[ name ];

			attributesData[ name ] = {
				id: attribute.isInterleavedBufferAttribute ? attribute.data.uuid : attribute.id,
				version: attribute.isInterleavedBufferAttribute ? attribute.data.version : attribute.version,
			};

		}

		return attributesData;

	}

	/**
	 * Returns `true` if the node builder's material uses
	 * node properties.
	 *
	 * @param {NodeBuilder} builder - The current node builder.
	 * @return {boolean} Whether the node builder's material uses node properties or not.
	 */
	containsNode( builder ) {

		const material = builder.material;

		for ( const property in material ) {

			if ( material[ property ] && material[ property ].isNode )
				return true;

		}

		if ( builder.context.modelViewMatrix || builder.context.modelNormalViewMatrix || builder.context.getAO || builder.context.getShadow )
			return true;

		return false;

	}

	/**
	 * Returns a geometry data structure holding the geometry property values for
	 * monitoring.
	 *
	 * @param {BufferGeometry} geometry - The geometry.
	 * @return {Object} An object for monitoring geometry properties.
	 */
	getGeometryData( geometry ) {

		let data = _geometryCache.get( geometry );

		if ( data === undefined ) {

			data = {
				_renderId: - 1,
				_version: 0,

				attributes: this.getAttributesData( geometry.attributes ),
				indexId: geometry.index ? geometry.index.id : null,
				indexVersion: geometry.index ? geometry.index.version : null,
				drawRange: { start: geometry.drawRange.start, count: geometry.drawRange.count }
			};

			// force refresh on dispose

			geometry.addEventListener( 'dispose', () => {

				data._version ++;

			} );

			_geometryCache.set( geometry, data );

		}

		return data;

	}

	/**
	 * Returns a texture data structure holding the texture state for
	 * monitoring.
	 *
	 * @param {Texture} texture - The texture.
	 * @return {Object} An object for monitoring the texture.
	 */
	getTextureData( texture ) {

		let data = _textureCache.get( texture );

		if ( data === undefined ) {

			data = { _version: 0 };

			// force refresh on dispose

			const onDispose = () => {

				data._version ++;

			};

			if ( texture.renderTarget !== null ) {

				texture.renderTarget.addEventListener( 'dispose', onDispose );

			} else {

				texture.addEventListener( 'dispose', onDispose );

			}

			_textureCache.set( texture, data );

		}

		return data;

	}

	/**
	 * Returns a material data structure holding the material property values for
	 * monitoring.
	 *
	 * @param {Material} material - The material.
	 * @return {Object} An object for monitoring material properties.
	 */
	getMaterialData( material ) {

		let data = _materialCache.get( material );

		if ( data === undefined ) {

			data = { _renderId: - 1, _version: 0 };

			for ( const property of this.refreshUniforms ) {

				const value = material[ property ];

				if ( value === undefined ) continue;

				if ( value === null ) {

					data[ property ] = null; // track unset properties

				} else if ( typeof value === 'object' && value.clone !== undefined ) {

					if ( value.isTexture === true ) {

						data[ property ] = { id: value.id, version: 0, cacheVersion: this.getTextureData( value )._version };

					} else {

						data[ property ] = value.clone();

					}

				} else {

					data[ property ] = value;

				}

			}

			_materialCache.set( material, data );

		}

		return data;

	}

	/**
	 * Returns `true` if the given render object has not changed its state.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 * @param {Array<Light>} lightsData - The current material lights.
	 * @param {number} renderId - The current render ID.
	 * @param {boolean} [isStatic=false] - Whether the render object belongs to a static render bundle. Then geometry
	 * attributes and instance buffers are not compared, the renderer uploads them without a full refresh.
	 * @return {boolean} Whether the given render object is equal to its cached state or not.
	 */
	equals( renderObject, lightsData, renderId, isStatic = false ) {

		const { object, material, geometry } = renderObject;

		const renderObjectData = this.getRenderObjectData( renderObject );

		// world matrix

		if ( renderObjectData.worldMatrix.equals( object.matrixWorld ) !== true ) {

			renderObjectData.worldMatrix.copy( object.matrixWorld );

			return false;

		}

		// material

		const materialData = this.getMaterialData( renderObject.material );

		// check the material properties just once per render for all render objects

		if ( materialData._renderId !== renderId ) {

			materialData._renderId = renderId;

			let changed = false;

			for ( const property in materialData ) {

				const value = materialData[ property ];
				const mtlValue = material[ property ];

				if ( property === '_renderId' ) continue;
				if ( property === '_version' ) continue;

				if ( value === null || mtlValue === null || mtlValue === undefined ) {

					// a property was assigned or removed since the last observation so a new snapshot is required

					if ( value !== ( mtlValue === undefined ? null : mtlValue ) ) {

						if ( mtlValue === null || mtlValue === undefined ) {

							materialData[ property ] = null;

						} else if ( mtlValue.isTexture === true ) {

							materialData[ property ] = { id: mtlValue.id, version: mtlValue.version, cacheVersion: this.getTextureData( mtlValue )._version };

						} else if ( typeof mtlValue === 'object' && mtlValue.clone !== undefined ) {

							materialData[ property ] = mtlValue.clone();

						} else {

							materialData[ property ] = mtlValue;

						}

						changed = true;

					}

				} else if ( value.equals !== undefined ) {

					if ( value.equals( mtlValue ) === false ) {

						value.copy( mtlValue );

						changed = true;

					}

				} else if ( mtlValue.isTexture === true ) {

					const textureData = this.getTextureData( mtlValue );

					if ( value.id !== mtlValue.id || value.version !== mtlValue.version || value.cacheVersion !== textureData._version ) {

						value.id = mtlValue.id;
						value.version = mtlValue.version;
						value.cacheVersion = textureData._version;

						changed = true;

					}

				} else if ( value !== mtlValue ) {

					materialData[ property ] = mtlValue;

					changed = true;

				}

			}

			if ( changed === true ) materialData._version ++;

		}

		// a version mismatch means the material has changed since this render object was last refreshed

		if ( renderObjectData.materialVersion !== materialData._version ) {

			renderObjectData.materialVersion = materialData._version;

			return false;

		}

		const { width, height } = renderObject.context;

		if ( renderObjectData.bufferWidth !== width || renderObjectData.bufferHeight !== height ) {

			renderObjectData.bufferWidth = width;
			renderObjectData.bufferHeight = height;

			return false;

		}

		// geometry

		if ( renderObjectData.geometryId !== geometry.id ) {

			renderObjectData.geometryId = geometry.id;
			renderObjectData.geometryVersion = this.getGeometryData( geometry )._version;

			return false;

		}

		// the attributes of static render bundles are only uploaded where they are expected to
		// change (instance and indirect buffers), see Renderer._updateBundle()

		if ( isStatic === false ) {

			const geometryData = this.getGeometryData( renderObject.geometry );

			// check the geometry properties just once per render for all render objects

			if ( geometryData._renderId !== renderId ) {

				geometryData._renderId = renderId;

				let changed = false;

				// attributes

				const attributes = geometry.attributes;
				const storedAttributes = geometryData.attributes;

				let currentAttributeCount = 0;
				let storedAttributeCount = 0;

				for ( const _ in attributes ) currentAttributeCount ++; // eslint-disable-line no-unused-vars

				for ( const name in storedAttributes ) {

					storedAttributeCount ++;

					const storedAttributeData = storedAttributes[ name ];
					const attribute = attributes[ name ];

					if ( attribute === undefined ) {

						// attribute was removed
						delete storedAttributes[ name ];

						changed = true;
						continue;

					}

					const id = attribute.isInterleavedBufferAttribute ? attribute.data.uuid : attribute.id;
					const version = attribute.isInterleavedBufferAttribute ? attribute.data.version : attribute.version;

					if ( storedAttributeData.id !== id || storedAttributeData.version !== version ) {

						storedAttributeData.id = id;
						storedAttributeData.version = version;

						changed = true;

					}

				}

				if ( storedAttributeCount !== currentAttributeCount ) {

					geometryData.attributes = this.getAttributesData( attributes );

					changed = true;

				}

				// check index

				const index = geometry.index;
				const currentIndexId = index ? index.id : null;
				const currentIndexVersion = index ? index.version : null;

				if ( geometryData.indexId !== currentIndexId || geometryData.indexVersion !== currentIndexVersion ) {

					geometryData.indexId = currentIndexId;
					geometryData.indexVersion = currentIndexVersion;

					changed = true;

				}

				// check drawRange

				if ( geometryData.drawRange.start !== geometry.drawRange.start || geometryData.drawRange.count !== geometry.drawRange.count ) {

					geometryData.drawRange.start = geometry.drawRange.start;
					geometryData.drawRange.count = geometry.drawRange.count;

					changed = true;

				}

				if ( changed === true ) geometryData._version ++;

			}

			// a version mismatch means the geometry has changed since this render object was last refreshed

			if ( renderObjectData.geometryVersion !== geometryData._version ) {

				renderObjectData.geometryVersion = geometryData._version;

				return false;

			}

		}

		// morph targets

		if ( renderObjectData.morphTargetInfluences ) {

			let morphChanged = false;

			for ( let i = 0; i < renderObjectData.morphTargetInfluences.length; i ++ ) {

				if ( renderObjectData.morphTargetInfluences[ i ] !== object.morphTargetInfluences[ i ] ) {

					renderObjectData.morphTargetInfluences[ i ] = object.morphTargetInfluences[ i ];
					morphChanged = true;

				}

			}

			if ( morphChanged ) return false;

		}

		// instancing

		if ( isStatic === false && object.isInstancedMesh === true ) {

			const instanceColorVersion = object.instanceColor !== null ? object.instanceColor.version : null;
			const morphTextureVersion = object.morphTexture !== null ? object.morphTexture.version : null;

			if ( renderObjectData.instanceMatrixVersion !== object.instanceMatrix.version ||
				renderObjectData.instanceColorVersion !== instanceColorVersion ||
				renderObjectData.morphTextureVersion !== morphTextureVersion ) {

				renderObjectData.instanceMatrixVersion = object.instanceMatrix.version;
				renderObjectData.instanceColorVersion = instanceColorVersion;
				renderObjectData.morphTextureVersion = morphTextureVersion;

				return false;

			}

		}

		// batching

		if ( object.isBatchedMesh === true ) {

			const colorsTextureVersion = object._colorsTexture !== null ? object._colorsTexture.version : null;

			if ( renderObjectData.matricesTextureVersion !== object._matricesTexture.version ||
				renderObjectData.colorsTextureVersion !== colorsTextureVersion ||
				renderObjectData.indirectTextureVersion !== object._indirectTexture.version ) {

				renderObjectData.matricesTextureVersion = object._matricesTexture.version;
				renderObjectData.colorsTextureVersion = colorsTextureVersion;
				renderObjectData.indirectTextureVersion = object._indirectTexture.version;

				return false;

			}

		}

		// lights

		if ( renderObjectData.lights ) {

			if ( renderObjectData.lights.length !== lightsData.length ) {

				// lights were added or removed (render objects of static content are kept)

				renderObjectData.lights = lightsData.map( ( lightData ) => Object.assign( {}, lightData ) );

				return false;

			}

			for ( let i = 0; i < lightsData.length; i ++ ) {

				const lightData = renderObjectData.lights[ i ];
				const currentLightData = lightsData[ i ];

				if ( lightData.map !== currentLightData.map || lightData.cacheVersion !== currentLightData.cacheVersion ||
					lightData.shadowMapWidth !== currentLightData.shadowMapWidth || lightData.shadowMapHeight !== currentLightData.shadowMapHeight ) {

					lightData.map = currentLightData.map;
					lightData.cacheVersion = currentLightData.cacheVersion;
					lightData.shadowMapWidth = currentLightData.shadowMapWidth;
					lightData.shadowMapHeight = currentLightData.shadowMapHeight;

					return false;

				}

			}

		}

		// scene

		const scene = renderObject.scene;

		if ( scene.environment !== null && material.envMap === null ) {

			if ( renderObjectData.environmentIntensity !== scene.environmentIntensity ||
					renderObjectData.environmentRotation.equals( scene.environmentRotation ) === false ) {

				renderObjectData.environmentIntensity = scene.environmentIntensity;
				renderObjectData.environmentRotation.copy( scene.environmentRotation );

				return false;

			}

		}

		// center

		if ( renderObjectData.center ) {

			if ( renderObjectData.center.equals( object.center ) === false ) {

				renderObjectData.center.copy( object.center );

				return false;

			}

		}

		// bundle

		if ( renderObject.bundle !== null ) {

			renderObjectData.version = renderObject.bundle.version;

		}

		return true;

	}

	/**
	 * Returns the lights data for the given material lights.
	 *
	 * @param {Array<Light>} materialLights - The material lights.
	 * @return {Array<Object>} The lights data for the given material lights.
	 */
	getLightsData( materialLights, lights ) {

		lights.length = 0;

		for ( const light of materialLights ) {

			let data = null;

			if ( light.isSpotLight === true && light.map !== null ) {

				// only add lights that have a map

				data = { map: light.map.version, cacheVersion: this.getTextureData( light.map )._version };

			}

			if ( light.castShadow === true && light.shadow !== undefined ) {

				// resizing a shadow map recreates its textures so the bindings
				// of all related render objects must be updated

				if ( data === null ) data = {};

				data.shadowMapWidth = light.shadow.mapSize.width;
				data.shadowMapHeight = light.shadow.mapSize.height;

			}

			if ( data !== null ) lights.push( data );

		}

		return lights;

	}

	/**
	 * Returns the lights for the given lights node and render ID.
	 *
	 * @param {LightsNode} lightsNode - The lights node.
	 * @param {number} renderId - The render ID.
	 * @return {Array<Object>} The lights for the given lights node and render ID.
	 */
	getLights( lightsNode, renderId ) {

		let cached = _lightsCache.get( lightsNode );

		if ( cached === undefined ) {

			cached = { renderId: - 1, lightsData: [] };
			_lightsCache.set( lightsNode, cached );

		}

		if ( cached.renderId === renderId ) {

			return cached.lightsData;

		}

		cached.renderId = renderId;
		this.getLightsData( lightsNode.getBuiltinLights(), cached.lightsData );

		return cached.lightsData;

	}

	/**
	 * Returns the object-scope bindings of the given render object whose values do not depend on
	 * the render object itself, i.e. uniforms, textures and storage buffers in non-shared uniform groups
	 * that are not written by a node updated per object. Used for static content with node materials.
	 *
	 * @private
	 * @param {RenderObject} renderObject - The render object.
	 * @return {Object} The tracked bindings and whether one of them is updated per frame or render.
	 */
	getObjectUniforms( renderObject ) {

		const nodeBuilderState = renderObject.getNodeBuilderState();

		// uniforms written by nodes that are updated per object (model matrices, material references,
		// onObjectUpdate() callbacks) are covered by equals(), not tracked here

		const ownedNodes = new Set();

		const addOwned = ( node ) => {

			if ( node.isUniformNode === true ) ownedNodes.add( node );

			for ( const property in node ) {

				const value = node[ property ];

				if ( value !== null && typeof value === 'object' && value.isUniformNode === true ) ownedNodes.add( value );

			}

		};

		for ( const node of nodeBuilderState.updateNodes ) if ( node.updateType === NodeUpdateType.OBJECT ) addOwned( node );
		for ( const node of nodeBuilderState.updateBeforeNodes ) if ( node.updateBeforeType === NodeUpdateType.OBJECT ) addOwned( node );
		for ( const node of nodeBuilderState.updateAfterNodes ) if ( node.updateAfterType === NodeUpdateType.OBJECT ) addOwned( node );

		const uniforms = [];
		const resources = [];
		let dynamic = false;

		for ( const bindGroup of renderObject.getBindings() ) {

			for ( const binding of bindGroup.bindings ) {

				if ( binding.groupNode !== undefined && binding.groupNode.shared === true ) continue;

				if ( binding.isNodeUniformsGroup === true ) {

					for ( const uniform of binding.uniforms ) {

						const node = uniform.nodeUniform.node;

						if ( ownedNodes.has( node ) ) continue;

						if ( node.updateType === NodeUpdateType.FRAME || node.updateType === NodeUpdateType.RENDER ) {

							// such nodes are updated after this check, so a change would be seen one render late

							dynamic = true;

						} else {

							uniforms.push( { node, value: this.cloneUniformValue( node.value ) } );

						}

					}

				} else if ( binding.isSampledTexture === true ) {

					const node = binding.textureNode;

					if ( ownedNodes.has( node ) === false && node.value !== null && node.value !== undefined ) {

						resources.push( { node, value: node.value, version: node.value.version } );

					}

				} else if ( binding.isStorageBuffer === true ) {

					const node = binding.nodeUniform;

					if ( node !== undefined && node !== null && ownedNodes.has( node ) === false && node.value ) {

						resources.push( { node, value: node.value, version: node.value.version } );

					} else {

						dynamic = true;

					}

				} else if ( binding.isUniformBuffer === true ) {

					dynamic = true;

				}

			}

		}

		return { uniforms, resources, dynamic };

	}

	/**
	 * Returns a copy of the given uniform value for change detection.
	 *
	 * @private
	 * @param {any} value - The uniform value.
	 * @return {any} The copy.
	 */
	cloneUniformValue( value ) {

		if ( value !== null && typeof value === 'object' && typeof value.clone === 'function' && typeof value.equals === 'function' ) return value.clone();

		return value;

	}

	/**
	 * Returns `true` if the values of the object-scope uniforms of the given render object changed since
	 * its last refresh. Values that do not depend on the render object are compared once per render
	 * for all render objects sharing this observer. A new version of the same texture or storage
	 * buffer only has to be uploaded, which is signaled with {@link NodeMaterialObserver#resourcesRenderId}.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 * @param {number} renderId - The current render ID.
	 * @return {boolean} Whether the object-scope uniforms changed or not.
	 */
	objectUniformsChanged( renderObject, renderId ) {

		if ( this.objectUniforms === null ) {

			this.objectUniforms = this.getObjectUniforms( renderObject );
			this.objectUniformsRenderId = renderId;

		} else if ( this.objectUniformsRenderId !== renderId ) {

			this.objectUniformsRenderId = renderId;

			const { uniforms, resources } = this.objectUniforms;

			let changed = false;

			for ( let i = 0, l = uniforms.length; i < l; i ++ ) {

				const entry = uniforms[ i ];
				const value = entry.node.value;
				const stored = entry.value;

				if ( stored !== null && typeof stored === 'object' && stored.equals !== undefined && value !== null && typeof value === 'object' && stored.constructor === value.constructor ) {

					if ( stored.equals( value ) === false ) {

						stored.copy( value );
						changed = true;

					}

				} else if ( stored !== value ) {

					entry.value = this.cloneUniformValue( value );
					changed = true;

				}

			}

			for ( let i = 0, l = resources.length; i < l; i ++ ) {

				const entry = resources[ i ];
				const value = entry.node.value;

				if ( value !== entry.value ) {

					entry.value = value;
					entry.version = value ? value.version : 0;
					changed = true;

				} else if ( value && value.version !== entry.version ) {

					entry.version = value.version;
					this.resourcesRenderId = renderId;

				}

			}

			if ( changed === true ) this.objectUniformsVersion ++;

		}

		if ( this.objectUniforms.dynamic === true ) return true;

		const data = this.getRenderObjectData( renderObject );

		if ( data.objectUniformsVersion !== this.objectUniformsVersion ) {

			data.objectUniformsVersion = this.objectUniformsVersion;

			return true;

		}

		return false;

	}

	/**
	 * Checks if the given render object requires a refresh.
	 *
	 * Render objects of static 3D objects ({@link Object3D#static}) and of static render bundles
	 * ({@link BundleGroup#static}) are only refreshed when something they depend on changed: the
	 * world matrix, the material properties, the render target size, the shadow maps of the lights
	 * or the values of object-scope uniforms (see {@link NodeMaterialObserver#objectUniformsChanged}).
	 * This also applies to node materials, whose render objects are otherwise refreshed every render.
	 * Uniforms in shared groups (e.g. `renderGroup`) are refreshed every render.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 * @param {NodeFrame} nodeFrame - The current node frame.
	 * @return {number} The refresh type, see {@link RenderObjectRefreshType}.
	 */
	needsRefresh( renderObject, nodeFrame ) {

		const isStatic = renderObject.object.static === true;
		const isStaticBundle = renderObject.bundle !== null && renderObject.bundle.static === true;

		if ( this.hasNode === true && isStatic === false && isStaticBundle === false )
			return RenderObjectRefreshType.FULL;

		if ( this.hasAnimation || this.hasDynamicInstancing( renderObject.object ) || this.needsVelocity( nodeFrame.renderer ) )
			return RenderObjectRefreshType.FULL;

		const { renderId } = nodeFrame;

		if ( isStatic === true || isStaticBundle === true ) {

			// static content

			const firstInitialization = this.firstInitialization( renderObject );
			const uniformsChanged = this.objectUniformsChanged( renderObject, renderId );

			if ( firstInitialization === true ) return RenderObjectRefreshType.FULL;

			const renderObjectData = this.getRenderObjectData( renderObject );

			if ( isStatic === false && renderObjectData.version !== renderObject.bundle.version ) {

				// the bundle was updated

				renderObjectData.version = renderObject.bundle.version;

				return RenderObjectRefreshType.FULL;

			}

			let refreshType = RenderObjectRefreshType.NONE;

			if ( this.renderId !== renderId ) {

				this.renderId = renderId;

				refreshType = RenderObjectRefreshType.SHARED;

			}

			const lightsData = this.getLights( renderObject.lightsNode, renderId );

			if ( this.equals( renderObject, lightsData, renderId, isStatic === false ) === false || uniformsChanged === true ) {

				refreshType = RenderObjectRefreshType.FULL;

			}

			return refreshType;

		}

		if ( this.firstInitialization( renderObject ) )
			return RenderObjectRefreshType.FULL;

		let refreshType = RenderObjectRefreshType.NONE;

		// shared UBOs are potentially never updated when objects don't change. Below block
		// make sure these UBOs are updated at least once.

		if ( this.renderId !== renderId ) {

			this.renderId = renderId;

			// no early out here. instead, use the equals() code path below so the internal cache state gets synched

			refreshType = RenderObjectRefreshType.SHARED;

		}

		const lightsData = this.getLights( renderObject.lightsNode, renderId );

		if ( this.equals( renderObject, lightsData, renderId ) === false ) {

			refreshType = RenderObjectRefreshType.FULL;

		}

		return refreshType;

	}

}

export default NodeMaterialObserver;
