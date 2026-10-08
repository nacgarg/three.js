import Renderer from '../../../../../src/renderers/common/Renderer.js';
import Backend from '../../../../../src/renderers/common/Backend.js';
import BundleGroup from '../../../../../src/renderers/common/BundleGroup.js';
import WGSLNodeBuilder from '../../../../../src/renderers/webgpu/nodes/WGSLNodeBuilder.js';
import MeshBasicNodeMaterial from '../../../../../src/materials/nodes/MeshBasicNodeMaterial.js';
import { Scene } from '../../../../../src/scenes/Scene.js';
import { Mesh } from '../../../../../src/objects/Mesh.js';
import { BoxGeometry } from '../../../../../src/geometries/BoxGeometry.js';
import { PerspectiveCamera } from '../../../../../src/cameras/PerspectiveCamera.js';
import { RenderTarget } from '../../../../../src/core/RenderTarget.js';
import QuadMesh from '../../../../../src/renderers/common/QuadMesh.js';
import NodeMaterial from '../../../../../src/materials/nodes/NodeMaterial.js';
import { DoubleSide } from '../../../../../src/constants.js';

// a backend that builds node materials but issues no GPU work

class RecordingBackend extends Backend {

	constructor() {

		super( { canvas: { style: {}, width: 1, height: 1, addEventListener() {}, removeEventListener() {} } } );

		this.utils = { getTextureSampleData: () => ( { primarySamples: 1 } ) };
		this.bundles = [];
		this.draws = [];

	}

	async init( renderer ) {

		this.renderer = renderer;

	}

	get coordinateSystem() {

		return 2000;

	}

	createNodeBuilder( object, renderer ) {

		return new WGSLNodeBuilder( object, renderer );

	}

	addBundle( renderContext, bundle ) {

		this.bundles.push( bundle );

	}

	createRenderPipeline( renderObject ) {

		this.get( renderObject.pipeline ).pipeline = {};

	}

	draw( renderObject ) {

		const context = renderObject.context;

		this.draws.push( {
			object: renderObject.object,
			material: renderObject.material,
			side: renderObject.material.side,
			lightsNode: renderObject.lightsNode,
			context: {
				width: context.width,
				height: context.height,
				textures: context.textures === null ? 0 : context.textures.length,
				clearColor: context.clearColor,
				clearDepth: context.clearDepth,
				clearColorValue: { ...context.clearColorValue },
				viewport: context.viewport,
				scissor: context.scissor,
				fullscreenPass: context.fullscreenPass,
				occlusionQueryCount: context.occlusionQueryCount
			}
		} );

	}

}

function createBackend() {

	const noop = () => {};

	return new Proxy( new RecordingBackend(), {
		get( target, property ) {

			return property in target ? target[ property ] : noop;

		}
	} );

}

export default QUnit.module( 'Renderers', () => {

	QUnit.module( 'Common', () => {

		QUnit.module( 'Renderer', () => {

			QUnit.test( 'renders nested in a bundle recording do not add to the bundle', async ( assert ) => {

				const backend = createBackend();
				const renderer = new Renderer( backend );

				await renderer.init();

				const camera = new PerspectiveCamera();
				const geometry = new BoxGeometry();

				const nestedScene = new Scene();
				const nestedMesh = new Mesh( geometry, new MeshBasicNodeMaterial() );
				nestedScene.add( nestedMesh );

				// a render started while the bundle is recorded, like a shadow map that is updated
				// before the first bundled object that samples it is drawn

				const bundledMesh = new Mesh( geometry, new MeshBasicNodeMaterial() );
				bundledMesh.onBeforeRender = () => renderer.render( nestedScene, camera );

				const bundleGroup = new BundleGroup();
				bundleGroup.add( bundledMesh );

				const scene = new Scene();
				scene.add( bundleGroup );

				renderer.render( scene, camera );

				assert.strictEqual( backend.bundles.length, 1, 'One bundle recorded.' );

				const renderObjects = backend.get( backend.bundles[ 0 ] ).renderObjects;

				assert.deepEqual( renderObjects.map( ( renderObject ) => renderObject.object ), [ bundledMesh ], 'The bundle only holds its own content.' );
				assert.strictEqual( renderer._currentRenderBundle, null, 'No bundle recorded after the render.' );

				renderer.dispose();

			} );

			QUnit.module( 'fullscreen quad fast path', () => {

				// renders the same content with the fast path on and off and returns both draw lists

				async function drawBoth( content ) {

					const results = [];

					for ( const fastPath of [ true, false ] ) {

						const backend = createBackend();
						const renderer = new Renderer( backend );
						renderer._quadFastPath = fastPath;

						await renderer.init();

						const target = new RenderTarget( 16, 8 );
						renderer.setRenderTarget( target );

						const objects = content( renderer );
						renderer.setRenderTarget( null );

						results.push( backend.draws.map( ( draw ) => ( { ...draw, object: objects.indexOf( draw.object ), material: objects.indexOf( draw.material ), lightsNode: draw.lightsNode === renderer.lighting.getNode( draw.object ) } ) ) );

						renderer.dispose();

					}

					return results;

				}

				QUnit.test( 'draws the same as the generic path', async ( assert ) => {

					const [ fast, generic ] = await drawBoth( ( renderer ) => {

						const materialA = new NodeMaterial();
						const materialB = new NodeMaterial();
						materialB.transparent = true;

						const quad = new QuadMesh( materialA );

						quad.render( renderer );

						renderer.autoClear = false;
						quad.material = materialB;
						quad.render( renderer );

						renderer.autoClear = true;
						renderer.setClearColor( 0x336699, 0.5 );
						quad.material = materialA;
						quad.render( renderer );

						return [ quad, materialA, materialB ];

					} );

					assert.strictEqual( fast.length, 3, 'One draw per quad render.' );
					assert.deepEqual( fast, generic, 'Same render objects and render context state.' );

				} );

				QUnit.test( 'skips what the generic path skips', async ( assert ) => {

					const [ fast, generic ] = await drawBoth( ( renderer ) => {

						const material = new NodeMaterial();
						const quad = new QuadMesh( material );

						quad.visible = false;
						quad.render( renderer );
						quad.visible = true;

						material.visible = false;
						quad.render( renderer );
						material.visible = true;

						quad.layers.set( 2 );
						quad.render( renderer );
						quad.layers.set( 0 );

						quad.render( renderer );

						return [ quad, material ];

					} );

					assert.strictEqual( fast.length, 1, 'Only the visible quad is drawn.' );
					assert.deepEqual( fast, generic, 'Same draws.' );

				} );

				QUnit.test( 'renders double-sided transparent materials in two passes', async ( assert ) => {

					const [ fast, generic ] = await drawBoth( ( renderer ) => {

						const material = new NodeMaterial();
						material.transparent = true;
						material.side = DoubleSide;

						const quad = new QuadMesh( material );
						quad.render( renderer );

						return [ quad, material ];

					} );

					assert.strictEqual( fast.length, 2, 'Back and front side.' );
					assert.deepEqual( fast, generic, 'Same draws.' );

				} );

				QUnit.test( 'renders children and nested quads', async ( assert ) => {

					const [ fast, generic ] = await drawBoth( ( renderer ) => {

						const outer = new QuadMesh( new NodeMaterial() );
						const inner = new QuadMesh( new NodeMaterial() );
						const child = new Mesh( new BoxGeometry(), new MeshBasicNodeMaterial() );

						// a quad render nested in a quad render, like an effect that renders its input first

						outer.onBeforeRender = () => inner.render( renderer );
						outer.render( renderer );

						// a quad with children takes the generic path

						inner.add( child );
						inner.render( renderer );

						return [ outer, inner, child, outer.material, inner.material, child.material ];

					} );

					assert.deepEqual( fast.map( ( draw ) => draw.object ), [ 1, 0, 1, 2 ], 'Nested quad, outer quad, quad and child.' );
					assert.deepEqual( fast, generic, 'Same draws.' );

				} );

				QUnit.test( 'releases the quad after the render', async ( assert ) => {

					const renderer = new Renderer( createBackend() );

					await renderer.init();

					const quad = new QuadMesh( new NodeMaterial() );
					quad.render( renderer );

					const renderList = renderer._quadRenderLists[ 0 ];

					assert.ok( renderList.renderItems.length > 0, 'The quad was projected into the quad render list.' );
					assert.ok( renderList.renderItems.every( ( item ) => item.object === null && item.material === null ), 'No references kept.' );

					renderer.dispose();

				} );

				QUnit.test( 'an unlit quad material does not depend on the lights', async ( assert ) => {

					const renderer = new Renderer( createBackend() );

					await renderer.init();

					const quad = new QuadMesh( new NodeMaterial() );
					const lightsNode = renderer.lighting.getNode( quad );

					let lightsKeys = 0;
					const getCacheKey = lightsNode.getCacheKey;
					lightsNode.getCacheKey = function ( ...args ) {

						lightsKeys ++;
						return getCacheKey.apply( this, args );

					};

					quad.render( renderer );
					quad.render( renderer );

					assert.strictEqual( lightsKeys, 0, 'No lights cache key for an unlit material.' );

					quad.material = new NodeMaterial();
					quad.material.lights = true;
					quad.render( renderer );

					assert.ok( lightsKeys > 0, 'A lit material still depends on the lights.' );

					delete lightsNode.getCacheKey;

					renderer.dispose();

				} );

			} );

		} );

	} );

} );
