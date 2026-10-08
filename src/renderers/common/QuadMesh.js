import { BufferGeometry } from '../../core/BufferGeometry.js';
import { Float32BufferAttribute } from '../../core/BufferAttribute.js';
import { Mesh } from '../../objects/Mesh.js';
import { OrthographicCamera } from '../../cameras/OrthographicCamera.js';
import { vec4, array } from '../../nodes/tsl/TSLBase.js';
import { vertexIndex } from '../../nodes/core/IndexNode.js';
import { warnOnce } from '../../utils.js';

const _camera = /*@__PURE__*/ new OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );

/**
 * The purpose of this special geometry is to fill the entire viewport with a single triangle.
 *
 * Reference: {@link https://github.com/mrdoob/three.js/pull/21358}
 *
 * @private
 * @augments BufferGeometry
 */
class QuadGeometry extends BufferGeometry {

	/**
	 * Constructs a new quad geometry.
	 *
	 * @param {boolean} [flipY=false] - Whether the uv coordinates should be flipped along the vertical axis or not.
	 */
	constructor( flipY = false ) {

		super();

		const uv = flipY === false ? [ 0, - 1, 0, 1, 2, 1 ] : [ 0, 2, 0, 0, 2, 0 ];

		this.setAttribute( 'position', new Float32BufferAttribute( [ - 1, 3, 0, - 1, - 1, 0, 3, - 1, 0 ], 3 ) );
		this.setAttribute( 'uv', new Float32BufferAttribute( uv, 2 ) );

	}

}

const _geometry = /*@__PURE__*/ new QuadGeometry();

const _vertexNode = /*@__PURE__*/ vec4(
	array( [ - 1.0, - 1.0, 3.0 ] ).element( vertexIndex ),
	array( [ 3.0, - 1.0, - 1.0 ] ).element( vertexIndex ),
	0.0,
	1.0
);

/**
 * This module is a helper for passes which need to render a full
 * screen effect which is quite common in context of post processing.
 *
 * The intended usage is to reuse a single quad mesh for rendering
 * subsequent passes by just reassigning the `material` reference.
 *
 * Note: This module can only be used with `WebGPURenderer`.
 *
 * @augments Mesh
 */
class QuadMesh extends Mesh {

	/**
	 * Constructs a new quad mesh.
	 *
	 * @param {NodeMaterial} material - The material to render the quad mesh with.
	 */
	constructor( material ) {

		super( _geometry, material );

		/**
		 * The camera to render the quad mesh with.
		 *
		 * @type {OrthographicCamera}
		 * @readonly
		 */
		this.camera = _camera;

		/**
		 * This flag can be used for type testing.
		 *
		 * @type {boolean}
		 * @readonly
		 * @default true
		 */
		this.isQuadMesh = true;

		/**
		 * The material the quad mesh was created with.
		 *
		 * @private
		 * @type {Material}
		 */
		this._initialMaterial = this.material;

		/**
		 * The last rendered material.
		 *
		 * @private
		 * @type {Material}
		 */
		this._renderedMaterial = this.material;

		/**
		 * Resets the material when the last rendered material is disposed. Quad meshes are often
		 * shared module-level instances whose material is assigned right before rendering. Without
		 * this, a disposed material and its node graph would stay referenced until the next render.
		 *
		 * @private
		 * @type {Function}
		 */
		this._onMaterialDispose = () => {

			const material = this._renderedMaterial;

			material.removeEventListener( 'dispose', this._onMaterialDispose );

			this._renderedMaterial = this._initialMaterial;

			if ( this.material === material ) this.material = this._initialMaterial;

		};

	}

	/**
	 * Async version of `render()`.
	 *
	 * @async
	 * @deprecated
	 * @param {Renderer} renderer - The renderer.
	 * @return {Promise} A Promise that resolves when the render has been finished.
	 */
	async renderAsync( renderer ) {

		warnOnce( 'QuadMesh: "renderAsync()" has been deprecated. Use "render()" and "await renderer.init();" when creating the renderer.' ); // @deprecated r181

		await renderer.init();

		renderer.render( this, _camera );

	}

	/**
	 * Renders the quad mesh
	 *
	 * @param {Renderer} renderer - The renderer.
	 */
	render( renderer ) {

		if ( this.material !== this._renderedMaterial ) this._trackMaterial( this.material );

		const previousVertexNode = this.material.vertexNode;

		this.material.vertexNode = _vertexNode;

		renderer.render( this, _camera );

		this.material.vertexNode = previousVertexNode;

	}

	/**
	 * Tracks the disposal of the given material if it isn't the initial one.
	 *
	 * @private
	 * @param {Material} material - The material to track.
	 */
	_trackMaterial( material ) {

		if ( this._renderedMaterial !== this._initialMaterial ) this._renderedMaterial.removeEventListener( 'dispose', this._onMaterialDispose );

		if ( material !== this._initialMaterial ) material.addEventListener( 'dispose', this._onMaterialDispose );

		this._renderedMaterial = material;

	}

}

export default QuadMesh;
