import DataMap from './DataMap.js';
import { AttributeType } from './Constants.js';

const _updatedBindings = [];

/**
 * This renderer module manages the bindings of the renderer.
 *
 * @private
 * @augments DataMap
 */
class Bindings extends DataMap {

	/**
	 * Constructs a new bindings management component.
	 *
	 * @param {Backend} backend - The renderer's backend.
	 * @param {NodeManager} nodes - Renderer component for managing nodes related logic.
	 * @param {Textures} textures - Renderer component for managing textures.
	 * @param {Attributes} attributes - Renderer component for managing attributes.
	 * @param {Pipelines} pipelines - Renderer component for managing pipelines.
	 * @param {Info} info - Renderer component for managing metrics and monitoring data.
	 */
	constructor( backend, nodes, textures, attributes, pipelines, info ) {

		super();

		/**
		 * The renderer's backend.
		 *
		 * @type {Backend}
		 */
		this.backend = backend;

		/**
		 * Renderer component for managing textures.
		 *
		 * @type {Textures}
		 */
		this.textures = textures;

		/**
		 * Renderer component for managing pipelines.
		 *
		 * @type {Pipelines}
		 */
		this.pipelines = pipelines;

		/**
		 * Renderer component for managing attributes.
		 *
		 * @type {Attributes}
		 */
		this.attributes = attributes;

		/**
		 * Renderer component for managing nodes related logic.
		 *
		 * @type {NodeManager}
		 */
		this.nodes = nodes;

		/**
		 * Incremented whenever the backend creates a bind group, see {@link BindGroup#version}.
		 *
		 * @type {number}
		 * @default 0
		 */
		this.version = 0;

		/**
		 * Renderer component for managing metrics and monitoring data.
		 *
		 * @type {Info}
		 */
		this.info = info;

		this.pipelines.bindings = this; // assign bindings to pipelines

	}

	/**
	 * Returns the bind groups for the given render object.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 * @return {Array<BindGroup>} The bind groups.
	 */
	getForRender( renderObject ) {

		const bindings = renderObject.getBindings();

		const renderObjectData = this.get( renderObject );

		if ( renderObjectData.initialized !== true ) {

			// bind groups are created once per object

			this._createBindings( bindings );

			renderObjectData.initialized = true;

		}

		return bindings;

	}

	/**
	 * Returns the bind groups for the given compute node.
	 *
	 * @param {Node} computeNode - The compute node.
	 * @return {Array<BindGroup>} The bind groups.
	 */
	getForCompute( computeNode ) {

		const bindings = this.nodes.getForCompute( computeNode ).bindings;
		const computeNodeData = this.get( computeNode );

		if ( computeNodeData.initialized !== true || computeNodeData.bindings !== bindings ) {

			// bind groups are created once per compute node version

			if ( computeNodeData.bindings !== undefined ) {

				this._destroyBindings( computeNodeData.bindings );

			}

			this._createBindings( bindings );

			computeNodeData.initialized = true;
			computeNodeData.bindings = bindings;

		}

		return bindings;

	}

	/**
	 * Updates the bindings for the given compute node.
	 *
	 * @param {Node} computeNode - The compute node.
	 */
	updateForCompute( computeNode ) {

		this._updateBindings( this.getForCompute( computeNode ) );

	}

	/**
	 * Updates the bindings for the given render object.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 */
	updateForRender( renderObject ) {

		this._updateBindings( this.getForRender( renderObject ) );

	}

	/**
	 * Updates only the shared uniform buffers of the given render object.
	 *
	 * @param {RenderObject} renderObject - The render object.
	 */
	updateSharedForRender( renderObject ) {

		const bindings = this.getForRender( renderObject );

		for ( const bindGroup of bindings ) {

			for ( const binding of bindGroup.bindings ) {

				if ( ( binding.isNodeUniformsGroup === true || binding.isNodeUniformBuffer === true ) && binding.groupNode.shared === true ) {

					const updatedGroup = this.nodes.updateGroup( binding );

					if ( updatedGroup === false ) continue;

					const updated = binding.update();

					if ( updated ) {

						this.backend.updateBinding( binding );

					}

					if ( binding.updateRanges.length > 0 ) binding.clearUpdateRanges();

				}

			}

		}

	}

	/**
	 * Deletes the bindings for the given compute node.
	 *
	 * @param {Node} computeNode - The compute node.
	 */
	deleteForCompute( computeNode ) {

		const computeNodeData = this.get( computeNode );
		const bindings = computeNodeData.bindings || this.nodes.getForCompute( computeNode ).bindings;

		this._destroyBindings( bindings );

		this.delete( computeNode );

	}

	/**
	 * Deletes the bindings for the given renderObject node.
	 *
	 * @param {RenderObject} renderObject - The renderObject.
	 */
	deleteForRender( renderObject ) {

		const renderObjectData = this.get( renderObject );

		// only release the bind groups the render object has acquired via getForRender(). A render object
		// can be disposed before its first update (e.g. when its material is disposed while it waits for
		// an async node build). Releasing in that case would decrement the usage count of shared bind
		// groups that are still in use by other render objects and destroy their uniform buffers.

		if ( renderObjectData.initialized === true ) {

			this._destroyBindings( renderObject.getBindings() );

		}

		this.delete( renderObject );

	}

	/**
	 * Creates the bindings for the given array of bindings.
	 *
	 * @param {Array<BindGroup>} bindings - The bind groups.
	 */
	_createBindings( bindings ) {

		for ( const bindGroup of bindings ) {

			// binding group

			const groupData = this.get( bindGroup );

			if ( groupData.bindGroup === undefined ) {

				// initialize

				for ( const binding of bindGroup.bindings ) {

					if ( binding.isUniformBuffer ) {

						this.backend.createUniformBuffer( binding );
						this.info.createUniformBuffer( binding );

					} else if ( binding.isSampledTexture ) {

						this.textures.updateTexture( binding.texture );

					} else if ( binding.isSampler ) {

						this.textures.updateSampler( binding );

					} else if ( binding.isStorageBuffer ) {

						const attribute = binding.attribute;
						const attributeType = attribute.isIndirectStorageBufferAttribute ? AttributeType.INDIRECT : AttributeType.STORAGE;

						this.attributes.update( attribute, attributeType );

					}

				}

				// each object defines an array of bindings (ubos, textures, samplers etc.)

				this.backend.createBindings( bindGroup, bindings, '' );

				bindGroup.version ++;
				this.version ++;

				groupData.bindGroup = bindGroup;
				groupData.usedTimes = 1;

			} else {

				groupData.usedTimes ++;

			}

		}

	}

	/**
	 * Deletes the given array of bindings.
	 *
	 * @param {Array<BindGroup>} bindings - The bind groups.
	 */
	_destroyBindings( bindings ) {

		for ( const bindGroup of bindings ) {

			const groupData = this.get( bindGroup );
			groupData.usedTimes --;

			if ( groupData.usedTimes === 0 ) {

				for ( const binding of bindGroup.bindings ) {

					if ( binding.isUniformBuffer ) {

						this.backend.destroyUniformBuffer( binding );
						this.info.destroyUniformBuffer( binding );

						// release arrays

						binding.release();

					} else if ( binding.isSampler ) {

						if ( binding.isSampledTexture !== true ) {

							this.backend.destroySampler( binding );

						} else if ( binding.texture !== null ) {

							// untrack destroyed bind group from its texture

							const textureData = this.textures.get( binding.texture );
							if ( textureData.bindGroups !== undefined ) textureData.bindGroups.delete( bindGroup );

						}

						binding.release();

					}

				}

				this.backend.deleteBindGroupData( bindGroup );
				this.delete( bindGroup );

			}

		}

	}

	/**
	 * Updates the given array of bindings.
	 *
	 * @param {Array<BindGroup>} bindings - The bind groups.
	 */
	_updateBindings( bindings ) {

		for ( const bindGroup of bindings ) {

			this._update( bindGroup, bindings );

		}

	}

	/**
	 * Updates the given bind group.
	 *
	 * @param {BindGroup} bindGroup - The bind group to update.
	 * @param {Array<BindGroup>} bindings - The bind groups.
	 */
	_update( bindGroup, bindings ) {

		const { backend } = this;

		let needsBindingsUpdate = false;

		// bindings checked in this call. The bind group cache key is only derived from them when a new
		// bind group is required, so the common (unchanged) case does no string building or extra lookups.
		// The array is used as a stack since _update() may re-enter through texture updates.

		const updatedBindings = _updatedBindings;
		const firstUpdated = updatedBindings.length;
		const groupBindings = bindGroup.bindings;

		// iterate over all bindings and check if buffer updates or a new binding group is required

		for ( let i = 0, l = groupBindings.length; i < l; i ++ ) {

			const binding = groupBindings[ i ];

			const updatedGroup = this.nodes.updateGroup( binding );

			// every uniforms group is a uniform buffer. So if no update is required,
			// we move one with the next binding. Otherwise the next if block will update the group.

			if ( updatedGroup === false ) continue;

			updatedBindings.push( binding );

			//

			if ( binding.isStorageBuffer ) {

				const attribute = binding.attribute;
				const attributeType = attribute.isIndirectStorageBufferAttribute ? AttributeType.INDIRECT : AttributeType.STORAGE;

				const bindingData = backend.get( binding );

				this.attributes.update( attribute, attributeType );

				if ( bindingData.attribute !== attribute ) {

					bindingData.attribute = attribute;

					needsBindingsUpdate = true;

				}

			}

			if ( binding.isUniformBuffer ) {

				const updated = binding.update();

				if ( updated ) {

					backend.updateBinding( binding );

				}

			} else if ( binding.isSampledTexture ) {

				const updated = binding.update();

				// get the texture data after the update, to sync the texture reference from node

				const texture = binding.texture;

				if ( updated ) {

					const texturesTextureData = this.textures.get( texture );

					// version: update the texture data or create a new one

					this.textures.updateTexture( texture );

					// generation: update the bindings if the binding refers to a different texture object

					if ( binding.generation !== texturesTextureData.generation ) {

						binding.generation = texturesTextureData.generation;

						needsBindingsUpdate = true;

					}

					// keep track which bind groups refer to the current texture (this is needed for dispose)

					texturesTextureData.bindGroups.add( bindGroup );

				}

				if ( texture.isStorageTexture === true && texture.mipmapsAutoUpdate === true ) {

					const textureData = this.get( texture );

					if ( binding.store === true ) {

						textureData.needsMipmap = true;

					} else if ( this.textures.needsMipmaps( texture ) && textureData.needsMipmap === true ) {

						this.backend.generateMipmaps( texture );

						textureData.needsMipmap = false;

					}

				}

			} else if ( binding.isSampler ) {

				const updated = binding.update();

				if ( updated ) {

					const samplerKey = this.textures.updateSampler( binding );

					if ( binding.samplerKey !== samplerKey ) {

						binding.samplerKey = samplerKey;

						needsBindingsUpdate = true;

					}

				}

			}

			if ( binding.isBuffer && binding.updateRanges.length > 0 ) {

				binding.clearUpdateRanges();

			}

		}

		if ( needsBindingsUpdate === true ) {

			let cacheBindings = true;
			let cacheKey = '';
			let version = 0;

			for ( let i = firstUpdated, l = updatedBindings.length; i < l; i ++ ) {

				const binding = updatedBindings[ i ];

				if ( binding.isStorageBuffer ) {

					cacheKey += binding.attribute.id + ',';

				}

				if ( binding.isUniformBuffer !== true && binding.isSampledTexture ) {

					const texture = binding.texture;
					const textureData = backend.get( texture );

					if ( textureData.externalTexture !== undefined || this.textures.get( texture ).isDefaultTexture ) {

						cacheBindings = false;

					} else {

						cacheKey += texture.id + ',';
						version += texture.version;

					}

				}

			}

			updatedBindings.length = firstUpdated;

			this.backend.updateBindings( bindGroup, bindings, cacheBindings ? cacheKey : '', version );

			bindGroup.version ++;
			this.version ++;

		} else {

			updatedBindings.length = firstUpdated;

		}

	}

}

export default Bindings;
