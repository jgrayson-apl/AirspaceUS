/*
  Copyright 2020 Esri

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

define([
  "calcite",
  "dojo/_base/declare",
  "ApplicationBase/ApplicationBase",
  "dojo/i18n!./nls/resources",
  "ApplicationBase/support/itemUtils",
  "ApplicationBase/support/domHelper",
  "dojo/dom-construct",
  "esri/identity/IdentityManager",
  "esri/Color",
  "esri/core/Evented",
  "esri/core/watchUtils",
  "esri/core/promiseUtils",
  "esri/portal/Portal",
  "esri/layers/Layer",
  "esri/widgets/Home",
  "esri/widgets/Search",
  "esri/widgets/LayerList",
  "esri/widgets/Legend",
  "esri/widgets/BasemapGallery",
  "esri/widgets/Expand"
], function(calcite, declare, ApplicationBase,
            i18n, itemUtils, domHelper, domConstruct,
            IdentityManager, Color, Evented, watchUtils, promiseUtils,
            Portal, Layer,
            Home, Search, LayerList, Legend, BasemapGallery, Expand){

  return declare([Evented], {

    /**
     *
     */
    constructor: function(){
      // BASE //
      this.base = null;
      // CALCITE WEB //
      calcite.init();
    },

    /**
     *
     * @param base
     */
    init: function(base){
      if(!base){
        console.error("ApplicationBase is not defined");
        return;
      }
      this.base = base;

      const webMapItems = this.base.results.webMapItems;
      const webSceneItems = this.base.results.webSceneItems;
      const validItems = webMapItems.concat(webSceneItems);
      const firstItem = (validItems && validItems.length) ? validItems[0].value : null;
      if(!firstItem){
        console.error("Could not load an item to display");
        return;
      }

      // TITLE //
      this.base.config.title = (this.base.config.title || itemUtils.getItemTitle(firstItem));
      domHelper.setPageTitle(this.base.config.title);
      document.querySelectorAll('.app-title').forEach(node => node.innerHTML = this.base.config.title);
      // DESCRIPTION //
      if(firstItem.description && firstItem.description.length){
        document.querySelectorAll('.app-description').forEach(node => node.innerHTML = firstItem.description);
      }

      const viewProperties = itemUtils.getConfigViewProperties(this.base.config);
      viewProperties.container = "view-node";
      viewProperties.constraints = { snapToZoom: false };

      const portalItem = this.base.results.applicationItem.value;
      const appProxies = (portalItem && portalItem.appProxies) ? portalItem.appProxies : null;

      itemUtils.createMapFromItem({ item: firstItem, appProxies: appProxies }).then(map => {
        viewProperties.map = map;
        itemUtils.createView(viewProperties).then(view => {
          view.when(() => {
            this.viewReady(this.base.config, firstItem, view).then(() => {
              view.container.classList.remove("loading");
            });
          });
        });
      });
    },

    /**
     *
     * @param config
     * @param item
     * @param view
     */
    viewReady: function(config, item, view){
      return promiseUtils.create((resolve, reject) => {

        // USER SIGN IN //
        this.initializeUserSignIn().catch(reject).then(() => {

          // VIEW LOADING //
          this.initializeViewLoading(view);

          // STARTUP DIALOG //
          this.initializeStartupDialog();

          // POPUP DOCKING OPTIONS //
          view.popup.dockEnabled = true;
          view.popup.dockOptions = {
            buttonEnabled: false,
            breakpoint: false,
            position: "top-center"
          };

          // SEARCH //
          const search = new Search({ view: view, searchTerm: this.base.config.search || "" });
          const searchExpand = new Expand({
            view: view,
            content: search,
            expandIconClass: "esri-icon-search",
            expandTooltip: "Search"
          });
          view.ui.add(searchExpand, { position: "top-left", index: 0 });

          // BASEMAPS //
          const basemapGalleryExpand = new Expand({
            view: view,
            content: new BasemapGallery({ view: view }),
            expandIconClass: "esri-icon-basemap",
            expandTooltip: "Basemap"
          });
          view.ui.add(basemapGalleryExpand, { position: "top-left", index: 1 });

          // HOME //
          const home = new Home({ view: view });
          view.ui.add(home, { position: "top-left", index: 2 });


          // LAYER LIST //
          const layerList = new LayerList({
            view: view,
            listItemCreatedFunction: function(evt){
              if(evt.item.layer && evt.item.layer.legendEnabled){
                evt.item.panel = { content: "legend" };
              }
            }
          });
          // LAYER LIST EXPAND //
          const layersExpand = new Expand({
            view: view,
            group: "top-right",
            content: layerList,
            expanded: true,
            expandIconClass: "esri-icon-layers",
            expandTooltip: "Layers"
          });
          view.ui.add(layersExpand, { position: "top-right", index: 0 });

          // PLACES //
          this.initializeSceneSlides(view);

          // APPLICATION READY //
          this.applicationReady(view).then(resolve).catch(reject);

        });
      });
    },

    /**
     *
     * @returns {*}
     */
    initializeUserSignIn: function(){

      const checkSignInStatus = () => {
        return IdentityManager.checkSignInStatus(this.base.portal.url).then(userSignIn).catch(userSignOut).then();
      };
      IdentityManager.on("credential-create", checkSignInStatus);

      // SIGN IN NODE //
      const signInNode = document.getElementById("sign-in-node");
      const userNode = document.getElementById("user-node");

      // UPDATE UI //
      const updateSignInUI = () => {
        if(this.base.portal.user){
          document.getElementById("user-firstname-node").innerHTML = this.base.portal.user.fullName.split(" ")[0];
          document.getElementById("user-fullname-node").innerHTML = this.base.portal.user.fullName;
          document.getElementById("username-node").innerHTML = this.base.portal.user.username;
          document.getElementById("user-thumb-node").src = this.base.portal.user.thumbnailUrl;
          signInNode.classList.add('hide');
          userNode.classList.remove('hide');
        } else {
          signInNode.classList.remove('hide');
          userNode.classList.add('hide');
        }
        return promiseUtils.resolve();
      };

      // SIGN IN //
      const userSignIn = () => {
        this.base.portal = new Portal({ url: this.base.config.portalUrl, authMode: "immediate" });
        return this.base.portal.load().then(() => {
          this.emit("portal-user-change", {});
          return updateSignInUI();
        }).catch(console.warn).then();
      };

      // SIGN OUT //
      const userSignOut = () => {
        IdentityManager.destroyCredentials();
        this.base.portal = new Portal({});
        return this.base.portal.load().then(() => {
          this.base.portal.user = null;
          this.emit("portal-user-change", {});
          return updateSignInUI();
        }).catch(console.warn).then();

      };

      // USER SIGN IN //
      signInNode.addEventListener("click", userSignIn);

      // SIGN OUT NODE //
      const signOutNode = document.getElementById("sign-out-node");
      if(signOutNode){
        signOutNode.addEventListener("click", userSignOut);
      }

      return checkSignInStatus();
    },

    /**
     *
     * @param view
     */
    initializeViewLoading: function(view){

      // LOADING //
      const updating_node = domConstruct.create("div", { className: "view-loading-node loader" });
      domConstruct.create("div", { className: "loader-bars" }, updating_node);
      domConstruct.create("div", { className: "loader-text font-size--3 text-white", innerHTML: "Updating..." }, updating_node);
      view.ui.add(updating_node, "bottom-right");
      watchUtils.init(view, "updating", (updating) => {
        updating_node.classList.toggle("is-active", updating);
      });

    },

    /**
     *
     */
    initializeStartupDialog: function(){

      // APP ID //
      const appID = `show-startup-${location.pathname.split('/')[2]}`;

      // STARTUP DIALOG //
      const showStartup = localStorage.getItem(appID) || 'show';
      if(showStartup === 'show'){
        calcite.bus.emit('modal:open', { id: 'app-details-dialog' });
      }

      // HIDE STARTUP DIALOG //
      const hideStartupInput = document.getElementById('hide-startup-input');
      hideStartupInput.checked = (showStartup === 'hide');
      hideStartupInput.addEventListener('change', () => {
        localStorage.setItem(appID, hideStartupInput.checked ? 'hide' : 'show');
      });

    },

    /**
     *
     * @param view
     */
    initializeSceneSlides: function(view){

      if(view.map.presentation && view.map.presentation.slides && (view.map.presentation.slides.length > 0)){

        const slidesContainer = domConstruct.create("div", { className: 'slides-container animate-in-up' });
        view.ui.add(slidesContainer, { index: 0 });

        const slideLabel = domConstruct.create("div", { className: "slide-label icon-ui-up icon-ui-flush text-center font-size-1", title: 'toggle slides' }, slidesContainer);
        slideLabel.addEventListener('click', () => {
          slidesContainer.classList.toggle('animate-in-up');
          slidesContainer.classList.toggle('animate-out-up');
          slideLabel.classList.toggle('icon-ui-up');
          slideLabel.classList.toggle('icon-ui-down');
        });

        const slides = view.map.presentation.slides;
        slides.forEach(slide => {

          const slideBtn = domConstruct.create("button", { className: "slide-btn tooltip tooltip-top", 'aria-label': slide.title.text }, slidesContainer);
          domConstruct.create("img", { className: "slide-btn-thumb", src: slide.thumbnail.url }, slideBtn);

          slideBtn.addEventListener("click", clickEvt => {
            clickEvt.stopPropagation();
            //slide.applyTo(view);
            view.goTo({ target: slide.viewpoint }).then(() => { view.focus(); });
          });

        });

      }

    },

    /**
     * APPLICATION READY
     *
     * @param view
     */
    applicationReady: function(view){
      return promiseUtils.create((resolve, reject) => {

        this.initializeAirspaceExpressions();

        Promise.all([
          this.initializeAirSpaceUseLayer(view),
          this.initializeSpecialUseAirspaceLayer(view),
          this.initializeRoutesLayer(view)
        ]).then(resolve).catch(reject);

      });
    },

    /**
     *
     */
    initializeAirspaceExpressions: function(){

      /**
       --UPPER_UOM--
       --LOWER_UOM--
       FL - Flight Level
       FT - Feet

       --UPPER_DESC--
       AA - And Above
       ANI - Above but not Including
       TI - To and Including
       TNI - To but not Including

       --UPPER_CODE--
       BYNOTAM - Given By NOTAM
       MSL - Mean Sea Level
       SFC - Surface
       STD - Standard Atmosphere
       UNLTD - Unlimited

       --LOWER_DESC--
       NULL - Not Applicable
       AA - And Above
       ANI - Above but not Including

       --LOWER_CODE--
       MSL - Mean Sea Level
       STD - Standard Atmospheric Pressure
       SFC - Surface
       */

      /**
       `--LOWER-- DESC: ${atts.LOWER_DESC} VAL: ${atts.LOWER_VAL} ${atts.LOWER_UOM} ${atts.LOWER_CODE}`,
       `--UPPER-- DESC: ${atts.UPPER_DESC} VAL: ${atts.UPPER_VAL} ${atts.UPPER_UOM} ${atts.UPPER_CODE}`,
       */

        // EXPRESSIONS //
      const expressions = new Map();

      // UpperValueAsMeters //
      expressions.set('UpperValueAsMeters', `
         var upperVal = $feature.UPPER_VAL;
         var upperUOM = $feature.UPPER_UOM;
         var lowerVal = $feature.LOWER_VAL;
         var lowerUOM = $feature.LOWER_UOM;
         upperVal = IIF(upperVal == -9998, 100000, upperVal);
         upperVal = IIF(upperUOM == "FL", upperVal * 100, upperVal);
         var lowerVal = IIF(lowerUOM == "FL", lowerVal * 100, lowerVal);
         return ((upperVal - lowerVal) * 0.3048);
       `);

      // LowerValueAsMeters //
      expressions.set('LowerValueAsMeters', ` 
         var lowerVal =  $feature.LOWER_VAL;
         lowerVal = IIF($feature.LOWER_UOM == "FL", lowerVal * 100, lowerVal);                            
         return IIF($feature.LOWER_CODE == "SFC", 0.0, (lowerVal * 0.3048));
       `);

      // AltitudeValueAsMeters //
      expressions.set('AltitudeValueAsMeters', `
       var max_alt = $feature.MAA_VAL;
       var MAA_UOM = $feature.MAA_UOM;          
       var MEA_E_VAL = $feature.MEA_E_VAL;
       var MEA_E_UOM = $feature.MEA_E_UOM;
       var MEA_W_VAL = $feature.MEA_W_VAL;
       var MEA_W_UOM  = $feature.MEA_W_UOM;
       var GMEA_E_VAL = $feature.GMEA_E_VAL;
       var GMEA_E_UOM = $feature.GMEA_E_UOM;
       max_alt = IIF(MAA_UOM == "FL", max_alt * 100, max_alt);                      
       max_alt = IIF(max_alt == 999999, MEA_E_VAL, max_alt);
       max_alt = IIF(MEA_E_UOM == "FL", max_alt * 100, max_alt);                    
       max_alt = IIF(max_alt == 999999, MEA_W_VAL, max_alt);
       max_alt = IIF(MEA_W_UOM == "FL", max_alt * 100, max_alt);          
       max_alt = IIF(max_alt == 999999, GMEA_E_VAL, max_alt);
       max_alt = IIF(MEA_E_UOM == "FL", max_alt * 100, max_alt);         
       max_alt = IIF(max_alt == 999999, 100000, max_alt);         
       return (max_alt * 0.3048);
     `);

      // GET EXPRESSION BY NAME //
      this.getExpressionByName = (name) => {
        return expressions.get(name);
      };

    },

    /**
     * http://ais-faa.opendata.arcgis.com
     * http://aeronav.faa.gov/Open_Data_Supp/Data_Dictionary.pdf
     *
     * @param view
     */
    initializeAirSpaceUseLayer: function(view){
      return promiseUtils.create((resolve, reject) => {

        // Airspace Boundary //
        Layer.fromPortalItem({ portalItem: { id: "cc6ce24755e048efb555d4527bd82cc5" } }).then((layer) => {
          layer.load().then(() => {

            layer.elevationInfo = {
              mode: "absolute-height",
              featureExpressionInfo: {
                expression: this.getExpressionByName('LowerValueAsMeters')
              }
            };

            layer.renderer = {
              type: 'simple',
              symbol: {
                /*type: 'simple-fill',
                color: 'rgba(255,255,0,0.1)',
                outline: {
                  color: '#9edb9e',
                  width: 2.5
                }*/
                type: "polygon-3d",
                symbolLayers: [
                  {
                    type: "extrude",
                    material: { color: 'transparent' }, //rgba(158,217,158,0.1)
                    edges: {
                      type: "solid",
                      color: '#9edb9e',
                      size: 2.5
                    }
                  }
                ]
              }
            };

            layer.renderer.visualVariables = [
              {
                type: "size",
                valueUnit: "meters",
                valueExpression: this.getExpressionByName('UpperValueAsMeters')
              }
            ];

            layer.set({
              title: 'US Airspace Boundary',
              visible: false
            });
            view.map.add(layer);
          });
        });

        // Class Airspace //
        Layer.fromPortalItem({ portalItem: { id: "02acaa96762c48b5a5db8a3e0eafee2b" } }).then((layer) => {
          layer.load().then(() => {
            //console.info(layer.title, layer.fields, layer);

            //const edgeColor = "#fff";

            layer.elevationInfo = {
              mode: "absolute-height",
              featureExpressionInfo: {
                expression: this.getExpressionByName('LowerValueAsMeters')
              }
            };

            // MODIFY SYMBOLS SO THEY'RE EXTRUDED //
            layer.renderer.uniqueValueInfos.forEach((uvi) => {

              const uviColor = new Color(uvi.symbol.color);
              //uviColor.a = 0.75;

              // const edgeColorHSL = uviColor.toHsl();
              // const uviEdgeColor = xColor.fromHsl(edgeColorHSL.h, edgeColorHSL.s, 25.0);

              uvi.symbol = {
                type: "polygon-3d",
                symbolLayers: [
                  {
                    type: "extrude",
                    material: { color: uviColor },
                    edges: {
                      type: "solid",
                      color: 'white',
                      size: 2.5
                    }
                  }
                ]
              }
            });
            // SET VISUAL VARIABLES TO POLYGONS ARE EXTRUDED TO UPPER VAL //
            layer.renderer.visualVariables = [
              {
                type: "size",
                valueUnit: "meters",
                valueExpression: this.getExpressionByName('UpperValueAsMeters')
              }
            ];

            layer.set({
              title: "US Airspace",
              labelsVisible: false,
              opacity: 0.5
            });
            view.map.add(layer);

            resolve();
          }).catch(reject);
        }).catch(reject);


      });
    },

    /**
     *
     * @param view
     * @returns {*}
     */
    initializeSpecialUseAirspaceLayer: function(view){
      return promiseUtils.create((resolve, reject) => {

        // U.S. Special Use Airspace //
        Layer.fromPortalItem({ portalItem: { id: "ac3373e13b974f5a9e8f0d0b042d0247" } }).then((layer) => {
          layer.load().then(() => {

            // ELEVATION INFO //
            layer.elevationInfo = {
              mode: "absolute-height",
              featureExpressionInfo: {
                expression: this.getExpressionByName('LowerValueAsMeters')
              }
            };

            // MODIFY SYMBOLS SO THEY'RE EXTRUDED //
            layer.renderer.symbol = {
              type: "polygon-3d",
              symbolLayers: [
                {
                  type: "extrude",
                  material: { color: layer.renderer.symbol.color },
                  edges: {
                    type: "solid",
                    //color: layer.renderer.symbol.color,
                    color: 'darkred',
                    size: 2.5
                  }
                }
              ]
            };

            // SET VISUAL VARIABLES TO POLYGONS ARE EXTRUDED TO UPPER VAL //
            layer.renderer.visualVariables = [
              {
                type: "size",
                valueUnit: "meters",
                valueExpression: this.getExpressionByName('UpperValueAsMeters')
              }
            ];

            layer.set({
              title: "US Special Use Airspace",
              visible: false,
              opacity: 0.5
            });
            view.map.add(layer);

            resolve();
          }).catch(reject);
        }).catch(reject);

      });
    },

    /**
     *
     * @param view
     * @returns {*}
     */
    initializeRoutesLayer: function(view){
      return promiseUtils.create((resolve, reject) => {

        // Route Airspace //
        /*Layer.fromPortalItem({ portalItem: { id: "68a1d263f998451bb9b322dee18031a7" } }).then((layer) => {
          layer.load().then(() => {
            view.map.add(layer);
          });
        });*/


        /**
         --TYPE_CODE--
         CONV - Navaid Based Route
         RNAV - Area Navigation
         OCEAN- Oceanic Route

         ADV - Advisory Route
         GRNAV - Ground Based RNAV
         SUB - Substitute Route
         UCON - Uncontrolled Route
         DIR - Direct or Track
         */


        // ATS Route //
        Layer.fromPortalItem({ portalItem: { id: "ad8bd1984ef943e4b477490ea71d904e" } }).then((layer) => {
          layer.load().then(() => {

            // ELEVATION INFO //
            layer.elevationInfo = {
              mode: "absolute-height",
              featureExpressionInfo: {
                expression: this.getExpressionByName('AltitudeValueAsMeters')
              }
            };

            // MODIFY SYMBOLS SO THEY'RE EXTRUDED //
            layer.renderer.uniqueValueInfos.forEach((uvi) => {
              uvi.symbol = {
                type: 'line-3d',
                symbolLayers: [
                  {
                    type: 'path',
                    profile: 'quad',
                    profileRotation: 'all',
                    join: 'round',
                    cap: 'round',
                    material: { color: uvi.symbol.color }
                  }
                ]
              }
            });

            // SET VISUAL VARIABLES TO POLYGONS ARE EXTRUDED TO WIDTH VAL //
            layer.renderer.visualVariables = [
              {
                type: "size",
                valueUnit: "nautical-miles",
                valueRepresentation: "width",
                valueExpression: "$feature.WIDTHRIGHT * 0.5"
              }/*,
              {
                type: "size",
                valueUnit: "nautical-miles",
                valueRepresentation: "height",
                valueExpression: "$feature.WIDTHRIGHT * 0.25"
              }*/
              // Accessor#set 'height' is not a valid value for this property, only the following values are valid: 'radius', 'diameter', 'area', 'width', 'distance'
            ];

            layer.set({
              title: "US ATS Routes",
              visible: false,
              opacity: 0.5
            });
            view.map.add(layer);

            resolve();
          }).catch(reject);
        }).catch(reject);

      });
    },

    /**
     *
     * @param view
     */
    initializeAirportsLayer: function(view){

      /**
       AIRANAL:"NO OBJECTION"
       AK_HIGH:1
       AK_LOW:1
       COUNTRY:"UNITED STATES"
       DODHIFLIP:0
       ELEVATION:19.5
       FAR91:0
       FAR93:0
       GLOBAL_ID:"656D38F0-F1FE-49A8-AB4F-677281616EF8"
       IAPEXISTS:1
       ICAO_ID:"PADK"
       IDENT:"ADK"
       LATITUDE:"51-53-00.8954N"
       LONGITUDE:"176-38-32.9277W"
       MIL_CODE:"CIVIL"
       NAME:"Adak"
       OBJECTID:1
       OPERSTATUS:"OPERATIONAL"
       PACIFIC:0
       PRIVATEUSE:0
       SERVCITY:"ADAK ISLAND"
       STATE:"AK"
       TYPE_CODE:"AD"
       US_AREA:0
       US_HIGH:0
       US_LOW:0
       */

      // Airports //
      /*Layer.fromPortalItem({ portalItem: { id: "ad324d389cc04acbb4dfdbb0e0806254" } }).then((layer) => {
        layer.load().then(() => {

          layer.title = "US Airports";
          layer.visible = false;
          layer.renderer = {
            type: "simple",
            symbol: {
              type: "point-3d",
              symbolLayers: [
                {
                  type: "object",
                  width: 100,
                  depth: 100,
                  height: 500,
                  anchor: "bottom",
                  resource: { primitive: "diamond" },
                  material: { color: Color.named.darkorange }
                }
              ]
            }
          };
          layer.labelsVisible = true;
          layer.labelingInfo = [
            {
              labelExpressionInfo: { value: "{Name}" },
              symbol: {
                type: "label-3d",
                labelPlacement: "above-center",
                symbolLayers: [
                  {
                    type: "text",
                    font: { family: "Avenir Next W00" },
                    size: 11,
                    material: { color: Color.named.darkorange },
                    halo: {
                      size: 2.0,
                      color: Color.named.white.concat(0.8)
                    }
                  }
                ],
                verticalOffset: {
                  screenLength: 100,
                  maxWorldLength: 20000,
                  minWorldLength: 1000
                },
                callout: {
                  type: "line",
                  color: Color.named.darkorange,
                  size: 1,
                  // border: { color: Color.named.white }
                }
              }
            }
          ];
          layer.featureReduction = null; //{ type: "selection" },
          layer.screenSizePerspectiveEnabled = true;

          view.map.add(layer);

          const airportsNode = dom.byId("airports-node");
          const airportsCountNode = dom.byId("airports-count");

          const displayAirportNode = (airportFeature) => {

            const airportNode = domConstruct.create("div", {
              className: "side-nav-link text-blue",
              innerHTML: lang.replace("{NAME}", airportFeature.attributes),
              title: lang.replace("{OPERSTATUS} :: {MIL_CODE}", airportFeature.attributes)
            });
            domConstruct.create("div", {
              className: "font-size--3 text-dark-gray avenir-italic text-right",
              innerHTML: `${airportFeature.attributes.SERVCITY || "---"}`
            }, airportNode);
            on(airportNode, "click", () => {
              view.goTo(airportFeature);
            });

            return airportNode
          };

          const airportsStore = new TrackableMemory({});
          const airportList = new OnDemandList({
            className: "dgrid-autoheight",
            collection: airportsStore,
            //sort: [{ property: "NAME", descending: false }],
            renderRow: displayAirportNode
          }, domConstruct.create("div", {}, airportsNode));
          airportList.startup();

          const _addAirportFeature = (airportFeature) => {
            airportFeature.id = String(airportFeature.uid);
            //airportFeature.NAME = airportFeature.getAttribute("NAME");
            airportsStore.add(airportFeature);
          };

          view.whenLayerView(layer).then((layerView) => {
            watchUtils.whenDefinedOnce(layerView, "controller", () => {
              const features = layerView.controller.graphics;

              airportsCountNode.innerHTML = number.format(features.length);
              features.forEach(_addAirportFeature);

              features.on("change", (evt) => {
                airportsCountNode.innerHTML = number.format(features.length);
                evt.added.forEach(_addAirportFeature)
              });
            });
          });

          const airportsLayerVisibilityChk = dom.byId("airports-layer-visibility");
          domClass.add(airportsLayerVisibilityChk, "icon-ui-checkbox-unchecked icon-ui-blue");

          watchUtils.init(layer, "visible", (visible) => {
            domClass.toggle(airportsLayerVisibilityChk, "icon-ui-checkbox-checked", (visible));
            domClass.toggle(airportsLayerVisibilityChk, "icon-ui-checkbox-unchecked", (!visible));
          });

          on(airportsLayerVisibilityChk, "click", () => {
            layer.visible = !layer.visible;
          });

        });
      });*/

    },

    /**
     * http://www.arcgis.com/home/item.html?id=da53700b1f324cc685c4d3bcc00c12fc
     * da53700b1f324cc685c4d3bcc00c12fc
     * f79e4f51c945465c9f3aefe95009bd34
     *
     * c82dc92a15504873ba044e65a94cb594
     *
     * @param view
     */
    initializeWeatherLayer: function(view){
      const deferred = new Deferred();

      const weatherLayer = new GroupLayer({
        title: "Weather",
        opacity: 0.8,
        visible: false,
        visibilityMode: "exclusive"
      });
      view.map.add(weatherLayer);

      Layer.fromPortalItem({ portalItem: { id: "f79e4f51c945465c9f3aefe95009bd34" } }).then((radarLayer) => {
        radarLayer.load().then(() => {
          radarLayer.visible = true;
          radarLayer.legendEnabled = false;
          this.watchLayerLoad(radarLayer);

          Layer.fromPortalItem({ portalItem: { id: "c82dc92a15504873ba044e65a94cb594" } }).then((cloudsLayer) => {
            cloudsLayer.load().then(() => {
              cloudsLayer.visible = false;
              cloudsLayer.legendEnabled = false;
              this.watchLayerLoad(cloudsLayer);

              weatherLayer.addMany([cloudsLayer, radarLayer]);

              deferred.resolve(weatherLayer);
            });
          });
        });
      });

      return deferred.promise;
    }

  });
});
